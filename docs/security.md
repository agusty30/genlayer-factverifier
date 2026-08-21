# Security Considerations

## Threat Model

The FactVerifier operates in an adversarial environment where:
- Users may submit malicious claims designed to manipulate LLM behavior
- Source URLs may contain adversarial content
- LLM outputs may be inconsistent, hallucinated, or malformed
- Multiple validators must reach consensus despite non-determinism
- Participants are economically motivated: submitters and challengers stake native tokens, so the value-handling paths must resist reentrancy, double-payout, and stuck-funds bugs

## Input Validation

### Claim Text Sanitization

Claims are validated before any LLM interaction:

- **Length bounds**: Maximum 1000 characters prevents prompt stuffing
- **Empty/whitespace rejection**: Prevents meaningless submissions
- **Prompt injection detection**: A blocklist of known injection patterns is checked against the lowercased claim text:
  - `ignore previous`, `ignore above`, `disregard`
  - `new instruction`, `system prompt`, `you are now`
  - `forget everything`, `override`

### Source URL Validation

- Only `http://` and `https://` schemes are accepted
- Maximum 500 characters per URL
- 2-5 sources required (minimum ensures cross-verification, maximum bounds computation cost)
- Domain deduplication: no two URLs from the same domain
- Empty URLs rejected

### Category and Context

- Category: max 100 characters, non-empty
- Context: max 500 characters (empty allowed)

## LLM Output Hardening

LLM responses are never trusted directly. Every output passes through normalization:

### JSON Parsing

```python
def _parse_llm_json(self, raw):
    # Handle dict passthrough
    # Strip markdown fences (```json ... ```)
    # Extract JSON from surrounding prose via brace-finding
    # Parse with json.loads
```

### Value Normalization

- **Confidence**: `_clamp_confidence()` coerces to int, clamps to [0, 100], defaults to 50 on parse failure
- **Boolean**: `_normalize_boolean()` handles `true`, `"true"`, `"yes"`, `"1"`, `"supported"`, `"supports"`
- **Text truncation**: Evidence capped at 300 chars, reasoning at 200 chars

## Consensus Security

### Semantic Equivalence vs. Exact Match

Using `prompt_comparative` instead of `strict_eq` prevents:
- Consensus failure from minor wording differences
- Validator rejection of correct-but-differently-worded analyses
- while still requiring validators to independently reproduce the conclusion

### Low-Confidence Exclusion

Sources with confidence < 10% are excluded from aggregation. This prevents:
- Irrelevant sources from diluting consensus
- Adversarial "noise injection" via unrelated URLs
- Meaningless votes from sources with no relevant content

### Weighted Scoring

High-confidence sources have proportionally more influence. This prevents:
- A single low-quality source from swinging a verdict
- Gaming via many low-confidence sources that all agree

## State Security

### Monotonic Counters

- `claim_counter` only increments, ensuring unique claim IDs
- `total_verified` and `total_refuted` maintain accurate running totals with bounds checking

### Immutable Fields

Once a claim is submitted, `claim_text`, `category`, and `submitter` cannot be modified. Only `status`, `consensus_score`, and source counts can change (via dispute).

### Per-Submitter Indexing

The `claim_ids_by_submitter` index uses JSON-encoded arrays in TreeMap string values (the nested TreeMap workaround pattern) to maintain per-user claim lists.

### Economic State Security

The staking layer ([economic-security.md](economic-security.md)) is written to be
safe against value-handling bugs:

- **Pull payments, not push.** Settlement never transfers tokens inline; it
  credits an internal `claimable` ledger, and recipients pull with `withdraw()`.
  A recipient that reverts on receipt cannot brick settlement for the other
  party, and there is no inline transfer to reenter during bookkeeping.
- **Checks-effects-interactions.** `withdraw()` and `withdraw_treasury()` zero the
  relevant balance *before* emitting the native transfer, so a reentrant call
  finds nothing left to withdraw.
- **Settlement is deterministic and post-consensus.** All stake math runs after
  the non-deterministic consensus block returns. No storage write depends on
  non-deterministic output beyond the already-agreed status, so validators settle
  identically.
- **Value conservation.** Every settlement satisfies
  `winner_payout + fee == submission_stake + challenge_stake`; nothing is minted
  or burned. `total_staked` is decremented by exactly the released stake.
- **Single-settlement invariant.** The `resolved` flag makes a claim settle at
  most once — it can be neither re-disputed nor finalized after settlement,
  preventing double-payout.
- **Authorization.** Only the submitter can `finalize_claim`; only the `owner`
  (deployer) can `withdraw_treasury`.

## Known Limitations

1. **Prompt injection is blocklist-based**: Novel injection patterns not in the blocklist may bypass detection. The blocklist should be updated as new patterns emerge.

2. **Source content trust**: The contract trusts that source URLs serve consistent content. A source that serves different content to leader vs. validators could cause consensus failure (which is the correct behavior — disagreement is surfaced as "disputed").

3. **LLM hallucination**: Despite normalization, an LLM may extract "evidence" that doesn't exist in the source text. The comparative equivalence check mitigates this — a hallucination unlikely to be independently reproduced by validators.

4. **Rate/cost**: Each source URL triggers a web render + LLM call on both leader and validators. Submitting 5 sources means 10+ web fetches and LLM calls per claim.

5. **No time-locked challenge window**: GenLayer's SDK (v0.3.0-rc7) exposes no block number or timestamp to contract code, so the contract cannot enforce a mandatory delay before a submitter finalizes. `finalize_claim` is therefore submitter-initiated. A submitter of a false claim could attempt to finalize before a challenger disputes; this is mitigated by consensus-driven transaction ordering (the submitter cannot guarantee their finalize is sequenced ahead of a pending dispute), and a true timelock will be adopted once the SDK exposes block time.

6. **Single-round disputes**: A claim can be challenged once, then it is resolved. This keeps settlement deterministic and simple; bonded appeal ladders / escalation games are future work.

7. **Withdrawal to reverting contracts**: `withdraw()` zeroes the ledger before transferring (CEI). If the recipient is a contract that rejects the transfer, the emitted message errors and the value is refunded to this contract via the SDK's error path; EOA recipients (the common case) are unaffected. A re-credit-on-failure escrow is future work.

## Recommendations for Integrators

- Validate claims client-side before submission to save gas
- Use reputable, stable source URLs (Wikipedia, major news outlets, government sites)
- Monitor `disputed` and `insufficient_sources` results — they indicate ambiguity, not failure
- Consider the dispute mechanism as a feature, not a bug — it enables adversarial verification
