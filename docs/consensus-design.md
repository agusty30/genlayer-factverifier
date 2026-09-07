# Consensus Design

## Why GenLayer Consensus Matters

Traditional smart contracts are deterministic — given the same inputs, they always produce the same outputs. This makes them unsuitable for tasks involving web data or natural language, where outputs vary between runs.

GenLayer solves this with the **Equivalence Principle**: a leader node produces a result, and validator nodes independently reproduce the computation. Consensus is reached not through exact string matching, but through semantic equivalence — validators verify that their results are *meaningfully the same* as the leader's.

## How FactVerifier Uses Consensus

### Per-Source Semantic Equivalence

Each source URL is analyzed independently by the leader and validators:

```python
gl.eq_principle.prompt_comparative(
    lambda: self._analyze_source_for_consensus(claim, url, context),
    "Compare the factual analysis results. Both should reach the same "
    "conclusion about whether the source supports or refutes the claim. "
    "The supports_claim boolean and confidence score (within 15 points) "
    "should be semantically equivalent."
)
```

This means:
- Leader analyzes `https://reuters.com/article` and concludes: `supports_claim: true, confidence: 85`
- Validator independently fetches and analyzes the same URL
- Validator might conclude: `supports_claim: true, confidence: 78`
- Consensus is reached because the conclusions are semantically equivalent (same boolean, confidence within tolerance)

### Why Not `strict_eq`?

`strict_eq` requires byte-identical outputs. LLM responses naturally vary in wording, confidence scores, and evidence extraction. Two runs analyzing the same Reuters article might produce:

- Run 1: `"confidence": 85, "evidence": "The Eiffel Tower, completed in 1889..."`
- Run 2: `"confidence": 82, "evidence": "Built for the 1889 World's Fair, the Eiffel Tower..."`

These convey the same factual conclusion but would fail `strict_eq`. `prompt_comparative` lets validators confirm semantic equivalence.

### Why Not `prompt_non_comparative`?

`prompt_non_comparative` validates each result in isolation. For fact verification, we need validators to independently reach the *same conclusion* from the *same source*. Comparative validation ensures the leader didn't hallucinate evidence that validators can't reproduce.

## Confidence Scoring

### Per-Source Confidence

Each source analysis produces a confidence score (0-100):

| Range | Meaning |
|-------|---------|
| 0-9 | No relevant information (excluded from aggregation) |
| 10-30 | Tangential or ambiguous evidence |
| 31-60 | Moderate evidence, some qualifications |
| 61-80 | Strong evidence with minor caveats |
| 81-100 | Definitive, unambiguous evidence |

### Weighted Consensus Score

The aggregate consensus score uses confidence-weighted voting:

```
weighted_score = Σ(confidence × direction)  where direction = +1 (supports) or -1 (refutes)
consensus_score = normalize(weighted_score / total_weight)  →  [0, 100]
```

A high-confidence supporting source counts more than a low-confidence one. This prevents a single low-quality source from swinging the verdict.

### Status Determination

| Consensus Score | Status |
|-----------------|--------|
| ≥ 70 | `verified` — Strong consensus that the claim is true |
| ≤ 30 | `refuted` — Strong consensus that the claim is false |
| 31-69 | `disputed` — Sources disagree or evidence is mixed |
| (no qualifying sources) | `insufficient_sources` — No source had confidence ≥ 10 |

## Dispute Mechanism

Any user can dispute a verified or refuted claim by providing new source URLs.
Disputes are **economically staked** — the challenger must lock at least the
submitter's original stake (see [economic-security.md](economic-security.md)).
The dispute process:

1. The challenge stake is checked (must be ≥ the submission stake)
2. New sources are analyzed with the same consensus mechanism (only the new
   sources go through consensus validation; previously consensus-validated
   sources keep their cached `(supports_claim, confidence)` records)
3. The newly validated results are re-aggregated with the previously
   consensus-validated results
4. Status may change based on the new aggregate score
5. **Settlement:** if the verdict flipped, the dispute *succeeds* and the
   challenger wins; if it held, the submitter wins. The winner is credited their
   own stake plus the loser's stake minus a 5% protocol fee, and the claim is
   marked `resolved` (it can never be disputed again)

This creates an open, adversarial verification system where claims can be
challenged with new evidence — and where challenging is only rational when the
challenger genuinely expects the verdict to flip, because being wrong forfeits
their stake. Note the settlement is a **deterministic** step run *after* the
non-deterministic consensus block returns, so it never introduces
non-determinism into validation.

## Design Decisions

### Multiple Independent Sources

Requiring 2-5 independent sources (from different domains) prevents single-source manipulation. A compromised website can't unilaterally verify false claims.

### Source Domain Deduplication

URLs from the same domain are rejected to ensure true source independence. Multiple articles from `reuters.com` would share the same editorial bias.

### Low-Confidence Exclusion

Sources scoring below 10% confidence are excluded from aggregation. This prevents irrelevant sources (e.g., a cooking blog for a physics claim) from diluting the consensus.

## Consensus-Validated vs. Explanatory-Only Fields

The leader's LLM call returns a structured object with four fields. Only two
of them enter the equivalence check; the other two are returned for the human
audit trail but are deliberately *not* part of consensus:

| Field | Role | Why |
|-------|------|-----|
| `supports_claim` (bool) | **Consensus-validated** | The boolean verdict the equivalence principle checks. Drives the `+1 / −1` direction in the weighted aggregate. |
| `confidence` (0–100) | **Consensus-validated** | The score the equivalence principle checks (within a tolerance band). Drives the magnitude in the weighted aggregate. |
| `evidence` (string) | Explanatory-only | A short quoted passage from the source. Stored on-chain for inspection. **Not** compared across runs because two honest analyses of the same article pick different sentences. |
| `reasoning` (string) | Explanatory-only | Free-text justification written by the LLM. Stored on-chain for inspection. **Not** compared across runs — different wordings for the same conclusion would produce false disagreements. |

This split keeps the on-chain record useful without breaking consensus. If
`evidence` and `reasoning` were consensus-validated, an honest validator that
happens to quote a different sentence from the same article would be marked as
disagreeing with the leader, and a single adversarial leader could craft the
prose fields to force disagreement even when the actual verdict matches.
Including them in the equivalence check would make consensus brittle; keeping
them explanatory-only means the human-readable audit trail stays rich while
the consensus check stays focused on the fields that actually determine the
verdict.

When a claim is disputed, only the new sources are sent through consensus
validation; the previously consensus-validated sources retain their cached
`(supports_claim, confidence)` records and are simply re-aggregated alongside
the newly validated ones. The full text of an old source is never re-read by
the LLM.
