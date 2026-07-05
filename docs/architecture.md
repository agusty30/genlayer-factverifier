# Architecture

## System Overview

The FactVerifier is a cross-source fact verification oracle built as a GenLayer Intelligent Contract. It enables decentralized, AI-powered verification of factual claims by aggregating evidence from multiple independent web sources and reaching consensus through GenLayer's equivalence principle.

## Component Architecture

```
┌─────────────────────────────────────────────────────┐
│                   FactVerifier Contract              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Input       │  │  Source       │  │ Consensus │ │
│  │   Validation  │  │  Analysis     │  │ Aggregator│ │
│  │              │  │              │  │           │ │
│  │ • Claim len  │  │ • Web fetch  │  │ • Weight  │ │
│  │ • URL format │  │ • LLM prompt │  │ • Score   │ │
│  │ • Injection  │  │ • JSON parse │  │ • Status  │ │
│  │ • Dedup      │  │ • Normalize  │  │ • Decide  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                 │                │       │
│  ┌──────▼─────────────────▼────────────────▼─────┐ │
│  │               State Storage                    │ │
│  │                                                │ │
│  │  claims: TreeMap[str, VerificationResult]       │ │
│  │  claim_ids_by_submitter: TreeMap[Address, str]  │ │
│  │  claim_counter: u256                            │ │
│  │  total_verified / total_refuted: u256           │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Verification Flow

```
1. User submits claim + source URLs
         │
         ▼
2. Input validation (length, format, injection detection)
         │
         ▼
3. For each source URL:
   ┌─────────────────────────────────────────┐
   │  a. gl.nondet.web.render() fetches page │
   │  b. LLM analyzes evidence vs. claim     │
   │  c. gl.eq_principle.prompt_comparative  │
   │     ensures validator consensus          │
   │  d. Normalize: clamp confidence,         │
   │     boolean coercion, truncate text      │
   └─────────────────────────────────────────┘
         │
         ▼
4. Aggregate results:
   - Weight each source by confidence
   - Calculate consensus score (0-100)
   - Determine status: verified / refuted / disputed / insufficient
         │
         ▼
5. Store on-chain: VerificationResult with full audit trail
```

## State Model

### VerificationResult

| Field | Type | Description |
|-------|------|-------------|
| claim_id | str | Unique identifier (claim_1, claim_2, ...) |
| claim_text | str | The factual claim being verified |
| category | str | Classification (science, geography, etc.) |
| submitter | str | Address of the claim submitter |
| status | str | pending / verified / refuted / disputed / insufficient_sources |
| consensus_score | u256 | Weighted confidence score (0-100) |
| source_count | u256 | Number of sources analyzed |
| sources_supporting | u256 | Count of supporting sources |
| sources_refuting | u256 | Count of refuting sources |
| final_reasoning | str | Aggregated reasoning summary |
| source_results_json | str | JSON array of per-source analysis details |

### Storage Layout

- `claims`: Primary claim store, keyed by claim_id
- `claim_ids_by_submitter`: Index mapping submitter addresses to their claim IDs (stored as JSON array in string)
- `claim_counter`: Monotonically increasing claim ID counter
- `total_verified` / `total_refuted`: Global statistics counters

## Security Model

### Input Sanitization

1. Claim length bounded (max 1000 chars)
2. Source URLs validated (HTTP/HTTPS only, no duplicates per domain)
3. Prompt injection detection (blocklist of known injection patterns)
4. Context length bounded (max 500 chars)

### LLM Output Normalization

1. JSON parsing with fence-stripping fallback
2. Confidence values clamped to [0, 100]
3. Boolean normalization handles string variants
4. Evidence and reasoning truncated to prevent storage bloat

### Consensus Security

- Each source analysis runs through `gl.eq_principle.prompt_comparative`
- Validators independently analyze the same source and must reach semantic agreement
- Low-confidence sources (< 10%) are excluded from aggregation to prevent noise
