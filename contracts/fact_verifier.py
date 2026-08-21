# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
from genlayer import *


# ── Status constants ─────────────────────────────────────────────────────────

STATUS_PENDING = "pending"
STATUS_VERIFIED = "verified"
STATUS_REFUTED = "refuted"
STATUS_DISPUTED = "disputed"
STATUS_INSUFFICIENT = "insufficient_sources"

CONFIDENCE_THRESHOLD = 70
MIN_SOURCES = 2
MAX_SOURCES = 5
MAX_CLAIM_LENGTH = 1000
MAX_SOURCE_URL_LENGTH = 500
MAX_CONTEXT_LENGTH = 500
MAX_CATEGORY_LENGTH = 100


# ── Economic staking parameters ───────────────────────────────────────────────
#
# The oracle is backed by an economic security layer: submitting a claim requires
# locking a stake, and challenging one requires matching it. The party the
# re-run consensus sides with recovers their own stake and takes the loser's
# stake minus a protocol fee. This makes spamming false claims and frivolous
# challenges costly, while honest participation is (fee aside) capital-preserving.
#
# Values are in the native token's smallest unit (1 GEN = 10**18).

MIN_SUBMISSION_STAKE = 10**16      # 0.01 GEN — minimum to submit a claim
PROTOCOL_FEE_BPS = 500             # 5% fee, taken from the loser's forfeited stake
BPS_DENOMINATOR = 10000


# ── Storage data types ───────────────────────────────────────────────────────

@allow_storage
@dataclass
class SourceResult:
    url: str
    supports_claim: bool
    confidence: u256
    extracted_evidence: str
    reasoning: str


@allow_storage
@dataclass
class VerificationResult:
    claim_id: str
    claim_text: str
    category: str
    submitter: str
    status: str
    consensus_score: u256
    source_count: u256
    sources_supporting: u256
    sources_refuting: u256
    final_reasoning: str
    source_results_json: str
    # ── Economic layer ──
    stake: u256              # native tokens locked by the submitter
    challenger: str          # hex address of the challenger ("" if never disputed)
    challenge_stake: u256    # native tokens locked by the challenger
    resolved: bool           # True once stakes have been settled (win/refund)
    winner: str              # hex address that recovered the stakes ("" until resolved)


class FactVerifier(gl.Contract):
    claims: TreeMap[str, VerificationResult]
    claim_ids_by_submitter: TreeMap[Address, str]
    claim_counter: u256
    total_verified: u256
    total_refuted: u256
    # ── Economic layer ──
    claimable: TreeMap[Address, u256]  # pull-payment ledger: withdrawable balances
    owner: Address                     # receives accumulated protocol fees
    treasury: u256                     # accumulated protocol fees (native tokens)
    total_staked: u256                 # native tokens currently locked in open claims
    total_disputes: u256               # lifetime number of disputes raised

    def __init__(self):
        self.claim_counter = u256(0)
        self.total_verified = u256(0)
        self.total_refuted = u256(0)
        self.owner = gl.message.sender_address
        self.treasury = u256(0)
        self.total_staked = u256(0)
        self.total_disputes = u256(0)

    # ── Internal: input validation ───────────────────────────────────────

    def _validate_claim(self, claim: str) -> None:
        if not claim or not claim.strip():
            raise gl.vm.UserError("Claim text cannot be empty")
        if len(claim) > MAX_CLAIM_LENGTH:
            raise gl.vm.UserError(f"Claim exceeds maximum length of {MAX_CLAIM_LENGTH}")
        lower = claim.lower()
        injection_markers = [
            "ignore previous", "ignore above", "disregard",
            "new instruction", "system prompt", "you are now",
            "forget everything", "override",
        ]
        for marker in injection_markers:
            if marker in lower:
                raise gl.vm.UserError("Claim contains disallowed content")

    def _validate_sources(self, source_urls: list) -> None:
        if len(source_urls) < MIN_SOURCES:
            raise gl.vm.UserError(f"At least {MIN_SOURCES} source URLs required")
        if len(source_urls) > MAX_SOURCES:
            raise gl.vm.UserError(f"Maximum {MAX_SOURCES} source URLs allowed")
        seen = set()
        for url in source_urls:
            if not url or not url.strip():
                raise gl.vm.UserError("Source URL cannot be empty")
            if len(url) > MAX_SOURCE_URL_LENGTH:
                raise gl.vm.UserError(f"Source URL exceeds maximum length of {MAX_SOURCE_URL_LENGTH}")
            if not url.startswith("http://") and not url.startswith("https://"):
                raise gl.vm.UserError("Source URL must start with http:// or https://")
            domain = url.split("://")[1].split("/")[0].lower()
            if domain in seen:
                raise gl.vm.UserError(f"Duplicate source domain: {domain}")
            seen.add(domain)

    def _validate_category(self, category: str) -> None:
        if not category or not category.strip():
            raise gl.vm.UserError("Category cannot be empty")
        if len(category) > MAX_CATEGORY_LENGTH:
            raise gl.vm.UserError(f"Category exceeds maximum length of {MAX_CATEGORY_LENGTH}")

    # ── Internal: parse and normalize LLM output ─────────────────────────

    def _parse_llm_json(self, raw) -> dict:
        if isinstance(raw, dict):
            return raw
        s = str(raw).strip()
        s = s.replace("```json", "").replace("```", "").strip()
        start = s.find("{")
        end = s.rfind("}") + 1
        if start >= 0 and end > start:
            s = s[start:end]
        return json.loads(s)

    def _clamp_confidence(self, value) -> int:
        try:
            v = int(value)
        except (ValueError, TypeError):
            return 50
        return max(0, min(100, v))

    def _normalize_boolean(self, value) -> bool:
        if isinstance(value, bool):
            return value
        s = str(value).lower().strip()
        return s in ("true", "yes", "1", "supported", "supports")

    def _normalize_analysis(self, raw_result) -> dict:
        parsed = self._parse_llm_json(raw_result)
        return {
            "supports_claim": self._normalize_boolean(parsed.get("supports_claim", False)),
            "confidence": self._clamp_confidence(parsed.get("confidence", 0)),
            "extracted_evidence": str(parsed.get("extracted_evidence", ""))[:300],
            "reasoning": str(parsed.get("reasoning", ""))[:200],
        }

    # ── Internal: aggregate results (deterministic) ──────────────────────

    def _aggregate_results(self, source_results: list) -> dict:
        total_sources = len(source_results)
        supporting = 0
        refuting = 0
        weighted_score = 0
        total_weight = 0

        for sr in source_results:
            conf = sr.get("confidence", 0)
            if conf < 10:
                continue
            total_weight += conf
            if sr.get("supports_claim", False):
                supporting += 1
                weighted_score += conf
            else:
                refuting += 1
                weighted_score -= conf

        if total_weight == 0:
            consensus_score = 0
        else:
            raw_score = (weighted_score + total_weight) * 50 // total_weight
            consensus_score = max(0, min(100, raw_score))

        if supporting + refuting == 0:
            status = STATUS_INSUFFICIENT
        elif consensus_score >= CONFIDENCE_THRESHOLD:
            status = STATUS_VERIFIED
        elif consensus_score <= (100 - CONFIDENCE_THRESHOLD):
            status = STATUS_REFUTED
        else:
            status = STATUS_DISPUTED

        return {
            "status": status,
            "consensus_score": consensus_score,
            "sources_supporting": supporting,
            "sources_refuting": refuting,
            "total_sources": total_sources,
        }

    # ── Internal: single source analysis with consensus ──────────────────

    def _analyze_single_source(self, claim: str, url: str, context: str) -> str:
        def _do_analysis() -> str:
            web_data = gl.nondet.web.render(url, mode="text")

            prompt = f"""Analyze whether the following web content supports or refutes the given factual claim.

CLAIM: {claim}

ADDITIONAL CONTEXT: {context}

WEB CONTENT FROM {url}:
{web_data}

You must respond ONLY with a valid JSON object in this exact format:
{{
    "supports_claim": true or false,
    "confidence": integer from 0 to 100,
    "extracted_evidence": "the specific text or data from the source that supports or refutes the claim",
    "reasoning": "brief explanation of why this evidence supports or refutes the claim"
}}

Rules:
- supports_claim: true if the source provides evidence supporting the claim, false if it refutes or contradicts it
- confidence: how confident you are in this assessment (0=no relevant info, 100=definitive proof)
- If the source has no relevant information, set confidence to 0 and supports_claim to false
- Extract ONLY factual evidence, not opinions
- Keep reasoning under 200 characters
- Keep extracted_evidence under 300 characters"""

            result = gl.nondet.exec_prompt(prompt, response_format="json")
            normalized = self._normalize_analysis(result)
            return json.dumps(normalized, sort_keys=True)

        return gl.eq_principle.prompt_comparative(
            _do_analysis,
            f"Compare the factual analysis results. Both should reach the same conclusion about whether the source supports or refutes the claim. The supports_claim boolean must match and confidence scores should be within 15 points of each other.",
        )

    # ── Public write methods ─────────────────────────────────────────────

    @gl.public.write.payable
    def submit_claim(
        self,
        claim: str,
        source_urls: list,
        category: str,
        context: str,
    ) -> str:
        self._validate_claim(claim)
        self._validate_sources(source_urls)
        self._validate_category(category)

        if context and len(context) > MAX_CONTEXT_LENGTH:
            raise gl.vm.UserError(f"Context exceeds maximum length of {MAX_CONTEXT_LENGTH}")

        stake = int(gl.message.value)
        if stake < MIN_SUBMISSION_STAKE:
            raise gl.vm.UserError(
                f"Submission requires a stake of at least {MIN_SUBMISSION_STAKE}"
            )

        submitter = gl.message.sender_address

        source_analyses = []
        for url in source_urls:
            analysis_json = self._analyze_single_source(claim, url, context)
            source_analyses.append(json.loads(analysis_json))

        aggregation = self._aggregate_results(source_analyses)

        self.claim_counter = u256(int(self.claim_counter) + 1)
        claim_id = f"claim_{int(self.claim_counter)}"

        if aggregation["status"] == STATUS_VERIFIED:
            self.total_verified = u256(int(self.total_verified) + 1)
        elif aggregation["status"] == STATUS_REFUTED:
            self.total_refuted = u256(int(self.total_refuted) + 1)

        reasoning_parts = []
        for i, sa in enumerate(source_analyses):
            verdict = "supports" if sa.get("supports_claim") else "refutes"
            reasoning_parts.append(
                f"Source {i + 1}: {verdict} (confidence: {sa.get('confidence', 0)}%)"
            )
        final_reasoning = "; ".join(reasoning_parts)

        source_results_data = []
        for i, sa in enumerate(source_analyses):
            source_results_data.append({
                "url": source_urls[i],
                "supports_claim": sa.get("supports_claim", False),
                "confidence": sa.get("confidence", 0),
                "evidence": sa.get("extracted_evidence", ""),
                "reasoning": sa.get("reasoning", ""),
            })

        result = VerificationResult(
            claim_id=claim_id,
            claim_text=claim,
            category=category,
            submitter=submitter.as_hex,
            status=aggregation["status"],
            consensus_score=u256(aggregation["consensus_score"]),
            source_count=u256(aggregation["total_sources"]),
            sources_supporting=u256(aggregation["sources_supporting"]),
            sources_refuting=u256(aggregation["sources_refuting"]),
            final_reasoning=final_reasoning,
            source_results_json=json.dumps(source_results_data, sort_keys=True),
            stake=u256(stake),
            challenger="",
            challenge_stake=u256(0),
            resolved=False,
            winner="",
        )

        self.claims[claim_id] = result
        self.total_staked = u256(int(self.total_staked) + stake)

        existing = self.claim_ids_by_submitter.get(submitter, "")
        if existing:
            id_list = json.loads(existing)
        else:
            id_list = []
        id_list.append(claim_id)
        self.claim_ids_by_submitter[submitter] = json.dumps(id_list)

        return claim_id

    @gl.public.write.payable
    def dispute_claim(self, claim_id: str, dispute_source_urls: list) -> None:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim_record = self.claims[claim_id]

        if claim_record.resolved:
            raise gl.vm.UserError("Claim already resolved")

        if claim_record.status not in (STATUS_VERIFIED, STATUS_REFUTED):
            raise gl.vm.UserError("Only verified or refuted claims can be disputed")

        self._validate_sources(dispute_source_urls)

        challenger = gl.message.sender_address
        challenge = int(gl.message.value)
        submitter_stake = int(claim_record.stake)
        if challenge < submitter_stake:
            raise gl.vm.UserError(
                f"Challenge stake must be at least the submission stake ({submitter_stake})"
            )

        claim_text = claim_record.claim_text
        new_analyses = []
        for url in dispute_source_urls:
            analysis_json = self._analyze_single_source(claim_text, url, "")
            new_analyses.append(json.loads(analysis_json))

        existing_sources = json.loads(claim_record.source_results_json)
        all_results = []
        for es in existing_sources:
            all_results.append({
                "supports_claim": es.get("supports_claim", False),
                "confidence": es.get("confidence", 0),
            })
        for na in new_analyses:
            all_results.append({
                "supports_claim": na.get("supports_claim", False),
                "confidence": na.get("confidence", 0),
            })

        aggregation = self._aggregate_results(all_results)

        old_status = claim_record.status
        new_status = aggregation["status"]

        if old_status == STATUS_VERIFIED and new_status != STATUS_VERIFIED:
            self.total_verified = u256(max(0, int(self.total_verified) - 1))
            if new_status == STATUS_REFUTED:
                self.total_refuted = u256(int(self.total_refuted) + 1)
        elif old_status == STATUS_REFUTED and new_status != STATUS_REFUTED:
            self.total_refuted = u256(max(0, int(self.total_refuted) - 1))
            if new_status == STATUS_VERIFIED:
                self.total_verified = u256(int(self.total_verified) + 1)

        for i, na in enumerate(new_analyses):
            existing_sources.append({
                "url": dispute_source_urls[i],
                "supports_claim": na.get("supports_claim", False),
                "confidence": na.get("confidence", 0),
                "evidence": na.get("extracted_evidence", ""),
                "reasoning": na.get("reasoning", ""),
            })

        claim_record.status = new_status
        claim_record.consensus_score = u256(aggregation["consensus_score"])
        claim_record.source_count = u256(
            int(claim_record.source_count) + len(new_analyses)
        )
        claim_record.sources_supporting = u256(aggregation["sources_supporting"])
        claim_record.sources_refuting = u256(aggregation["sources_refuting"])
        claim_record.source_results_json = json.dumps(
            existing_sources, sort_keys=True
        )

        reasoning_parts = []
        for i, sr in enumerate(existing_sources):
            verdict = "supports" if sr.get("supports_claim") else "refutes"
            reasoning_parts.append(
                f"Source {i + 1}: {verdict} (confidence: {sr.get('confidence', 0)}%)"
            )
        claim_record.final_reasoning = "; ".join(reasoning_parts)

        # ── Settle stakes ────────────────────────────────────────────────
        # A dispute "succeeds" when re-running consensus flips the verdict.
        # The winner recovers their own stake and takes the loser's stake
        # minus the protocol fee. Payouts go to the pull-payment ledger so
        # this method performs no external transfer (see withdraw()).
        dispute_succeeds = new_status != old_status
        if dispute_succeeds:
            winner_addr = challenger
            fee = submitter_stake * PROTOCOL_FEE_BPS // BPS_DENOMINATOR
            payout = challenge + (submitter_stake - fee)
        else:
            winner_addr = Address(claim_record.submitter)
            fee = challenge * PROTOCOL_FEE_BPS // BPS_DENOMINATOR
            payout = submitter_stake + (challenge - fee)

        prev_claimable = int(self.claimable.get(winner_addr, u256(0)))
        self.claimable[winner_addr] = u256(prev_claimable + payout)
        self.treasury = u256(int(self.treasury) + fee)
        self.total_staked = u256(max(0, int(self.total_staked) - submitter_stake))

        claim_record.challenger = challenger.as_hex
        claim_record.challenge_stake = u256(challenge)
        claim_record.resolved = True
        claim_record.winner = winner_addr.as_hex
        self.total_disputes = u256(int(self.total_disputes) + 1)

    @gl.public.write
    def finalize_claim(self, claim_id: str) -> None:
        """Close an unchallenged claim and return the submitter's stake.

        Only the submitter may finalize, and only while the claim is still
        open (not resolved). This releases locked capital once the submitter
        is confident no challenge is coming. Note: without on-chain block
        time the SDK cannot enforce a mandatory challenge window, so this is
        a submitter-initiated settlement rather than a timelocked one.
        """
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim_record = self.claims[claim_id]
        if claim_record.resolved:
            raise gl.vm.UserError("Claim already resolved")

        submitter_addr = Address(claim_record.submitter)
        if gl.message.sender_address.as_hex != claim_record.submitter:
            raise gl.vm.UserError("Only the submitter can finalize this claim")

        stake_amount = int(claim_record.stake)
        prev_claimable = int(self.claimable.get(submitter_addr, u256(0)))
        self.claimable[submitter_addr] = u256(prev_claimable + stake_amount)
        self.total_staked = u256(max(0, int(self.total_staked) - stake_amount))

        claim_record.resolved = True
        claim_record.winner = claim_record.submitter

    @gl.public.write
    def withdraw(self) -> None:
        """Withdraw the caller's accumulated balance (pull-payment)."""
        sender = gl.message.sender_address
        amount = int(self.claimable.get(sender, u256(0)))
        if amount <= 0:
            raise gl.vm.UserError("Nothing to withdraw")

        # Checks-effects-interactions: zero the ledger before transferring.
        self.claimable[sender] = u256(0)
        gl.get_contract_at(sender).emit_transfer(value=u256(amount))

    @gl.public.write
    def withdraw_treasury(self) -> None:
        """Owner-only withdrawal of accumulated protocol fees."""
        if gl.message.sender_address.as_hex != self.owner.as_hex:
            raise gl.vm.UserError("Only the owner can withdraw the treasury")

        amount = int(self.treasury)
        if amount <= 0:
            raise gl.vm.UserError("Treasury is empty")

        self.treasury = u256(0)
        gl.get_contract_at(self.owner).emit_transfer(value=u256(amount))

    # ── Public view methods ──────────────────────────────────────────────

    @gl.public.view
    def get_claim(self, claim_id: str) -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        c = self.claims[claim_id]
        return {
            "claim_id": c.claim_id,
            "claim_text": c.claim_text,
            "category": c.category,
            "submitter": c.submitter,
            "status": c.status,
            "consensus_score": int(c.consensus_score),
            "source_count": int(c.source_count),
            "sources_supporting": int(c.sources_supporting),
            "sources_refuting": int(c.sources_refuting),
            "final_reasoning": c.final_reasoning,
            "source_results": json.loads(c.source_results_json),
        }

    @gl.public.view
    def get_claim_status(self, claim_id: str) -> str:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        return self.claims[claim_id].status

    @gl.public.view
    def get_claims_by_submitter(self, submitter_address: str) -> list:
        addr = Address(submitter_address)
        raw = self.claim_ids_by_submitter.get(addr, "")
        if not raw:
            return []
        return json.loads(raw)

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_claims": int(self.claim_counter),
            "total_verified": int(self.total_verified),
            "total_refuted": int(self.total_refuted),
            "total_disputes": int(self.total_disputes),
            "total_staked": int(self.total_staked),
            "treasury": int(self.treasury),
        }

    @gl.public.view
    def get_stake_info(self, claim_id: str) -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        c = self.claims[claim_id]
        return {
            "stake": int(c.stake),
            "challenger": c.challenger,
            "challenge_stake": int(c.challenge_stake),
            "resolved": c.resolved,
            "winner": c.winner,
            "status": c.status,
        }

    @gl.public.view
    def get_claimable(self, address: str) -> int:
        addr = Address(address)
        return int(self.claimable.get(addr, u256(0)))

    @gl.public.view
    def get_treasury(self) -> int:
        return int(self.treasury)

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def is_claim_verified(self, claim_id: str) -> bool:
        if claim_id not in self.claims:
            return False
        return self.claims[claim_id].status == STATUS_VERIFIED
