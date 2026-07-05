# FactVerifier — Cross-Source Fact Verification Oracle

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/8Jm4v89VAu)
[![Telegram](https://img.shields.io/badge/Telegram--T.svg?style=social&logo=telegram)](https://t.me/genlayer)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/yeagerai.svg?style=social&label=Follow%20%40GenLayer)](https://x.com/GenLayer)

A production-quality GenLayer Intelligent Contract that verifies factual claims by aggregating evidence from multiple independent web sources and reaching AI-powered consensus. Built as a reusable oracle primitive that other contracts and applications can integrate.

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
    test_fact_verifier.py   # 40+ test cases
    test_create_bet.py
    test_resolve_bet.py
    test_views.py
    test_patterns.py
  integration/              # Full tests against GenLayer Studio
    test_fact_verifier.py
    test_football_bets.py
docs/
  architecture.md           # System architecture and state model
  consensus-design.md       # Consensus mechanism deep dive
  security.md               # Security considerations and threat model
examples/
  basic_verification.py     # Simple verification workflow
  multi_claim_batch.py      # Batch verification and integration patterns
deploy/
  deployFactVerifier.ts     # Deployment script for FactVerifier
  deployScript.ts           # Deployment script for FootballBets
frontend/                   # Next.js 15 app (from boilerplate)
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

#### `submit_claim(claim, source_urls, category, context) → str`

Submit a factual claim for verification.

| Parameter | Type | Description |
|-----------|------|-------------|
| claim | str | The factual claim to verify (max 1000 chars) |
| source_urls | list | 2-5 independent source URLs (different domains) |
| category | str | Classification (e.g., "science", "geography") |
| context | str | Additional context for analysis (max 500 chars) |

Returns the claim ID (e.g., `"claim_1"`).

#### `dispute_claim(claim_id, dispute_source_urls)`

Challenge a verified or refuted claim with new sources.

| Parameter | Type | Description |
|-----------|------|-------------|
| claim_id | str | ID of the claim to dispute |
| dispute_source_urls | list | 2-5 new source URLs as counter-evidence |

### View Methods

#### `get_claim(claim_id) → dict`

Returns the full verification result including all source analyses.

#### `get_claim_status(claim_id) → str`

Returns just the status: `"verified"`, `"refuted"`, `"disputed"`, or `"insufficient_sources"`.

#### `is_claim_verified(claim_id) → bool`

Convenience method. Returns `True` only if status is `"verified"`.

#### `get_claims_by_submitter(submitter_address) → list`

Returns all claim IDs submitted by an address.

#### `get_stats() → dict`

Returns `{"total_claims": int, "total_verified": int, "total_refuted": int}`.

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

## Testing Strategy

| Test Type | Command | Tests | Speed |
|-----------|---------|-------|-------|
| Lint | `genvm-lint check contracts/fact_verifier.py` | Static analysis | ~250ms |
| Direct | `pytest tests/direct/test_fact_verifier.py -v` | 40+ unit tests | ~ms/test |
| Integration | `gltest tests/integration/test_fact_verifier.py -v -s` | 5 e2e tests | ~min/test |

Test coverage includes:
- Input validation (empty, too long, malformed)
- Prompt injection detection
- Verified/refuted/disputed/insufficient outcomes
- Multi-source consensus
- Confidence clamping and normalization
- Multi-user claim submission
- Dispute mechanism
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
- [Security](docs/security.md) — Threat model and mitigations
- [GenLayer Docs](https://docs.genlayer.com/) — Full GenLayer documentation
- [SDK API Reference](https://sdk.genlayer.com/main/_static/ai/api.txt) — Complete SDK API

## Community

- [Discord](https://discord.gg/8Jm4v89VAu) — Discussions, support, announcements
- [Telegram](https://t.me/genlayer) — Informal chats and quick updates

## License

MIT — see [LICENSE](LICENSE) for details.
