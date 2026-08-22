# FactVerifier — Cross-Source Fact Verification Oracle

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/8Jm4v89VAu)
[![Telegram](https://img.shields.io/badge/Telegram--T.svg?style=social&logo=telegram)](https://t.me/genlayer)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/yeagerai.svg?style=social&label=Follow%20%40GenLayer)](https://x.com/GenLayer)

A production-quality GenLayer Intelligent Contract that verifies factual claims by aggregating evidence from multiple independent web sources and reaching AI-powered consensus. Built as a reusable oracle primitive that other contracts and applications can integrate.

It is backed by an **economic staking layer**: submitting a claim and challenging one both require locking native GEN, and the party consensus sides with is rewarded from the other's stake (minus a small protocol fee). This gives the oracle skin-in-the-game spam resistance and a sustainable fee model. See [docs/economic-security.md](docs/economic-security.md) and [MILESTONE.md](MILESTONE.md).

## Live Deployment & Web App

FactVerifier is **live on the GenLayer Bradbury testnet**, and the `frontend/` directory is a
real dApp whose every action is a transaction against that contract — not a demo mock.

| | |
|---|---|
| **Network** | Bradbury testnet (chainId `4221`) |
| **Contract** | [`0x0341797e201C1e697E89a199E6bC0e2e0bF5193a`](https://explorer-bradbury.genlayer.com/address/0x0341797e201C1e697E89a199E6bC0e2e0bF5193a) |
| **RPC** | `https://rpc-bradbury.genlayer.com` |
| **Explorer** | `https://explorer-bradbury.genlayer.com` |

**App ↔ contract flow** (see [frontend/README.md](frontend/README.md) for details):

1. **Submit** — the UI validates the claim + 2–5 sources client-side (mirroring the
   contract's own checks), then calls `submit_claim(...)` with the stake sent as the payable
   `value`. genlayer-js signs it through the user's MetaMask on Bradbury.
2. **Read** — `get_stats`, `get_claim`, and `get_stake_info` are read live and rendered as the
   stats bar, claims table, per-source analysis, and settlement state.
3. **Dispute / Finalize / Withdraw** — `dispute_claim` (payable), `finalize_claim`, and
   `withdraw` are wired to contextual buttons; the pull-payment balance from `get_claimable`
   surfaces in the account panel and a dedicated withdraw panel.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 — connect MetaMask on Bradbury
```

Reads work with no wallet; writes require MetaMask on Bradbury and a little GEN for stake + fees.

## Why GenLayer?

Traditional smart contracts cannot access the web or reason about natural language. GenLayer changes this:

| Capability | Traditional Smart Contracts | GenLayer + FactVerifier |
|---|---|---|
| Web access | Not possible | Fetches and renders web pages natively |
| Natural language reasoning | Not possible | LLM-powered evidence analysis |
| Consensus on subjective data | Not possible | Semantic equivalence principle |
| Oracle feeds | Requires external oracle networks | Built-in, decentralized |

FactVerifier demonstrates all of these in a single, reusable contract.

## How It Works

```
User submits:  "The Eiffel Tower is in Paris"
               + [reuters.com/article, wikipedia.org/Eiffel_Tower]

    ┌──────────────────────────────────────┐
    │         Input Validation             │
    │  • Length checks                     │
    │  • URL format & domain dedup         │
    │  • Prompt injection detection        │
    └──────────────┬───────────────────────┘
                   ▼
    ┌──────────────────────────────────────┐
    │   Per-Source Analysis (× N sources)  │
    │                                      │
    │  Leader:    fetch URL → LLM analyze  │
    │  Validator: fetch URL → LLM analyze  │
    │                                      │
    │  gl.eq_principle.prompt_comparative  │
    │  ensures semantic consensus          │
    └──────────────┬───────────────────────┘
                   ▼
    ┌──────────────────────────────────────┐
    │       Consensus Aggregation          │
    │                                      │
    │  Confidence-weighted scoring:        │
    │  • ≥70 → verified                   │
    │  • ≤30 → refuted                    │
    │  • 31-69 → disputed                 │
    │  • No data → insufficient_sources   │
    └──────────────┬───────────────────────┘
                   ▼
    On-chain result with full audit trail
```

## Project Structure

```
contracts/
  fact_verifier.py          # Main intelligent contract
  football_bets.py          # Example contract (from boilerplate)
tests/
  direct/                   # Fast in-memory tests (no Studio required)
    test_fact_verifier.py   # 49 verification + validation test cases
    test_staking.py         # 28 economic-layer test cases (stakes, disputes, payouts)
    test_create_bet.py
    test_resolve_bet.py
    test_views.py
    test_patterns.py
  integration/              # Full tests against GenLayer Studio
    test_fact_verifier.py   # 8 e2e tests incl. finalize/withdraw and dispute settlement
    test_football_bets.py
docs/
  architecture.md           # System architecture and state model
  consensus-design.md       # Consensus mechanism deep dive
  economic-security.md      # Staking, dispute settlement, and payout design
  security.md               # Security considerations and threat model
examples/
  basic_verification.py     # Simple verification workflow
  multi_claim_batch.py      # Batch verification and integration patterns
deploy/
  deployFactVerifier.ts     # Deployment script for FactVerifier
  deployScript.ts           # Deployment script for FootballBets
frontend/                   # Next.js dApp — live FactVerifier UI (submit/dispute/finalize/withdraw)
MILESTONE.md                # What changed since the accepted version, and why
```

## Quick Start

### 1. Set up Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Lint the contract

```bash
genvm-lint check contracts/fact_verifier.py
```

### 3. Run direct mode tests

```bash
pytest tests/direct/test_fact_verifier.py -v
```

### 4. Deploy to GenLayer Testnet

```bash
genlayer network          # Select testnet
genlayer deploy           # Deploy using deploy/deployFactVerifier.ts
```

### 5. Run integration tests

```bash
gltest tests/integration/test_fact_verifier.py -v -s
```

## Contract API

### Write Methods

#### `submit_claim(claim, source_urls, category, context) → str`  *(payable)*

Submit a factual claim for verification. **Requires a stake** of at least
`MIN_SUBMISSION_STAKE` (0.01 GEN) sent as the call value; the stake is locked
until the claim is finalized or a dispute settles it.

| Parameter | Type | Description |
|-----------|------|-------------|
| claim | str | The factual claim to verify (max 1000 chars) |
| source_urls | list | 2-5 independent source URLs (different domains) |
| category | str | Classification (e.g., "science", "geography") |
| context | str | Additional context for analysis (max 500 chars) |
| *value* | GEN | Stake ≥ 0.01 GEN (sent as native value, not an argument) |

Returns the claim ID (e.g., `"claim_1"`). Input validation runs *before* the
stake check, so malformed claims are rejected regardless of the value sent.

#### `dispute_claim(claim_id, dispute_source_urls)`  *(payable)*

Challenge a verified or refuted claim with new sources. **Requires a challenge
stake** of at least the original submission stake. Consensus is re-run over the
combined sources; if the verdict flips the challenger wins, otherwise the
submitter wins. The winner's payout (own stake + loser's stake − fee) is credited
to the pull-payment ledger and the fee goes to the treasury. Settles the claim.

| Parameter | Type | Description |
|-----------|------|-------------|
| claim_id | str | ID of the claim to dispute |
| dispute_source_urls | list | 2-5 new source URLs as counter-evidence |
| *value* | GEN | Challenge stake ≥ the submission stake |

#### `finalize_claim(claim_id)`

Submitter-only. Closes an unchallenged claim and credits the submitter's stake
back to their withdrawable balance. Reverts if the claim is already resolved.

#### `withdraw()`

Withdraw the caller's accumulated balance (dispute winnings and/or finalized
stakes). Uses checks-effects-interactions: the ledger is zeroed before the
native transfer is emitted.

#### `withdraw_treasury()`

Owner-only. Transfers accumulated protocol fees to the owner (the deployer).

### View Methods

#### `get_claim(claim_id) → dict`

Returns the full verification result including all source analyses. (Backward
compatible — economic fields live in `get_stake_info`.)

#### `get_claim_status(claim_id) → str`

Returns just the status: `"verified"`, `"refuted"`, `"disputed"`, or `"insufficient_sources"`.

#### `is_claim_verified(claim_id) → bool`

Convenience method. Returns `True` only if status is `"verified"`.

#### `get_claims_by_submitter(submitter_address) → list`

Returns all claim IDs submitted by an address.

#### `get_stake_info(claim_id) → dict`

Returns the claim's economic state: `{stake, challenger, challenge_stake, resolved, winner, status}`.

#### `get_claimable(address) → int`

Returns the address's withdrawable balance (native units).

#### `get_treasury() → int`

Returns accumulated protocol fees (native units).

#### `get_owner() → str`

Returns the owner address (the deployer, who can withdraw the treasury).

#### `get_stats() → dict`

Returns `{"total_claims", "total_verified", "total_refuted", "total_disputes", "total_staked", "treasury"}` (all int).

## Consensus Design

The contract uses **semantic equivalence** via `gl.eq_principle.prompt_comparative`. When analyzing a source:

1. The **leader node** fetches the web page, sends it to the LLM with a structured prompt, and extracts `{supports_claim, confidence, evidence, reasoning}`
2. **Validator nodes** independently perform the same analysis
3. Consensus is reached if validators produce semantically equivalent conclusions — the same boolean verdict and confidence within tolerance

This means:
- Leader: `"supports_claim": true, "confidence": 85`
- Validator: `"supports_claim": true, "confidence": 78`
- **Consensus reached** — same conclusion, confidence within range

See [docs/consensus-design.md](docs/consensus-design.md) for the full design rationale.

## Security

- **Input validation**: Length bounds, URL format checks, domain deduplication
- **Prompt injection detection**: Blocklist of known injection patterns
- **LLM output normalization**: JSON fence stripping, confidence clamping, boolean coercion
- **Low-confidence exclusion**: Sources below 10% confidence don't influence the verdict
- **Weighted scoring**: High-confidence sources have proportionally more influence

See [docs/security.md](docs/security.md) for the complete threat model.

## Economic Security

Verification alone is advisory — anyone could spam claims or file frivolous
disputes for free. The economic layer attaches a cost to being wrong:

| Mechanism | Effect |
|-----------|--------|
| **Submission stake** (≥ 0.01 GEN) | Spamming claims locks capital per claim |
| **Challenge stake** (≥ submission stake) | Frivolous disputes risk the challenger's own stake |
| **Winner takes loser's stake** | Being right is rewarded; being wrong is slashed |
| **5% protocol fee** | Funds a sustainable treasury from the loser's stake |
| **Pull-payment ledger** | Winners `withdraw()`; settlement never pushes transfers |

**Settlement (per dispute):** re-run consensus over original + new sources. If
the verdict flips, the challenger wins; otherwise the submitter wins. The winner
is credited `own_stake + (loser_stake − fee)`; the treasury takes `fee`. Value is
conserved: `winner_payout + fee == submission_stake + challenge_stake`.

An unchallenged claim's submitter can `finalize_claim()` to reclaim their stake.
All accounting is deterministic and unit-tested; see
[docs/economic-security.md](docs/economic-security.md) for the full design,
worked examples, and known limitations.

## Testing Strategy

| Test Type | Command | Tests | Speed |
|-----------|---------|-------|-------|
| Lint | `genvm-lint check contracts/fact_verifier.py` | Static analysis | ~250ms |
| Direct (core) | `pytest tests/direct/test_fact_verifier.py -v` | 49 unit tests | ~ms/test |
| Direct (economic) | `pytest tests/direct/test_staking.py -v` | 28 unit tests | ~ms/test |
| Integration | `gltest tests/integration/test_fact_verifier.py -v -s` | 8 e2e tests | ~min/test |

Test coverage includes:
- Input validation (empty, too long, malformed)
- Prompt injection detection
- Verified/refuted/disputed/insufficient outcomes
- Multi-source consensus
- Confidence clamping and normalization
- Multi-user claim submission
- Dispute mechanism and stake settlement (challenger/submitter wins)
- Submission & challenge stake requirements
- Finalization, pull-payment withdrawal, treasury (owner-only)
- Value conservation across settlement
- Edge cases (max lengths, malformed LLM output)

## Integration Patterns

FactVerifier is designed as a **reusable primitive**. Other contracts can call it to verify claims before executing actions:

```python
# DAO governance: verify a claim before executing a proposal
if fact_verifier.is_claim_verified(claim_id):
    dao.execute_proposal(proposal_id)

# News aggregation: filter verified articles
for article in articles:
    claim_id = fact_verifier.submit_claim(article.headline, article.sources, ...)
    if fact_verifier.is_claim_verified(claim_id):
        publish(article)
```

See [examples/](examples/) for complete usage patterns.

## Requirements

- Python >= 3.12
- [GenLayer CLI](https://github.com/genlayerlabs/genlayer-cli): `npm install -g genlayer`
- GenLayer Studio (for integration tests): [Docs](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup)

## Documentation

- [Architecture](docs/architecture.md) — System design, state model, verification flow
- [Consensus Design](docs/consensus-design.md) — Why and how consensus works
- [Economic Security](docs/economic-security.md) — Staking, dispute settlement, payouts
- [Security](docs/security.md) — Threat model and mitigations
- [Milestone](MILESTONE.md) — What changed since the accepted version, and why
- [GenLayer Docs](https://docs.genlayer.com/) — Full GenLayer documentation
- [SDK API Reference](https://sdk.genlayer.com/main/_static/ai/api.txt) — Complete SDK API

## Community

- [Discord](https://discord.gg/8Jm4v89VAu) — Discussions, support, announcements
- [Telegram](https://t.me/genlayer) — Informal chats and quick updates

## License

MIT — see [LICENSE](LICENSE) for details.
