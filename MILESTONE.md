# Milestone: Economic Staking Layer

This document is the **documented delta** for the FactVerifier milestone: exactly
what changed since the accepted version, and why it matters.

## Baseline (the accepted version)

FactVerifier was accepted as a cross-source fact-verification oracle: submit a
claim with 2–5 independent source URLs, and the contract fetches each source,
analyzes it with an LLM under GenLayer's equivalence principle, and aggregates a
confidence-weighted verdict (`verified` / `refuted` / `disputed` /
`insufficient_sources`). Anyone could dispute a verdict with new sources.

- **Accepted deployment (Bradbury):** `0x65282cB9AA0D9a8AbbF61c0acEa20e334fed1680`
  · [Explorer](https://explorer-bradbury.genlayer.com/address/0x65282cB9AA0D9a8AbbF61c0acEa20e334fed1680)

In that version, verification was **advisory and free**: submitting or disputing
cost nothing, so there was no economic penalty for spamming claims or filing
frivolous challenges — the weak point for an oracle other contracts are meant to
rely on.

## What changed: an Economic Staking Layer

The milestone adds a full economic security layer that turns verification into a
staked, adversarial game with real skin in the game. This is **new contract
functionality** and a **security/architecture improvement**, plus a **new
deployment**.

- **Milestone deployment (Bradbury):** `0x0341797e201C1e697E89a199E6bC0e2e0bF5193a`
  · [Explorer](https://explorer-bradbury.genlayer.com/address/0x0341797e201C1e697E89a199E6bC0e2e0bF5193a)
  · deploy tx `0xdde62d8c6940193f03d78d0ef4d1aca5dfd589399efe765d212f9955d2ddac55`

### 1. Staked submissions and challenges

- `submit_claim` is now **payable** and requires a stake of at least
  `MIN_SUBMISSION_STAKE` (0.01 GEN). The stake is locked against the claim.
- `dispute_claim` is now **payable** and requires a challenge stake of at least
  the original submission stake.

### 2. Economic settlement of disputes

When a claim is disputed, consensus validates the new sources and
re-aggregates them with the previously consensus-validated sources:

- If the verdict **flips**, the dispute succeeds and the **challenger wins**.
- If the verdict **holds**, the **submitter wins**.
- The winner is credited `own_stake + (loser_stake − fee)`; a **5% protocol fee**
  (`PROTOCOL_FEE_BPS`) on the loser's stake goes to the treasury.
- Value is conserved: `winner_payout + fee == submission_stake + challenge_stake`.
- The claim is marked `resolved` and can never be disputed or finalized again.

### 3. Finalization and pull-payment withdrawals

- `finalize_claim` (new, submitter-only) closes an unchallenged claim and returns
  the submitter's stake to their withdrawable balance.
- `withdraw` (new) lets any participant pull their winnings/returned stakes. It
  follows checks-effects-interactions (zero the ledger, then transfer).
- `withdraw_treasury` (new, owner-only) transfers accumulated fees to the deployer.

### 4. New economic state and views

- Storage: `claimable` (pull-payment ledger), `owner`, `treasury`,
  `total_staked`, `total_disputes`; `VerificationResult` gains `stake`,
  `challenger`, `challenge_stake`, `resolved`, `winner`.
- New views: `get_stake_info`, `get_claimable`, `get_treasury`, `get_owner`.
- `get_stats` now also reports `total_disputes`, `total_staked`, and `treasury`.

## API delta at a glance

| Method | Before | After |
|--------|--------|-------|
| `submit_claim` | write | **payable**, requires ≥ 0.01 GEN stake |
| `dispute_claim` | write (only re-aggregated validated sources) | **payable**, requires ≥ submission stake, **settles stakes** |
| `finalize_claim` | — | **new** (submitter reclaims stake) |
| `withdraw` | — | **new** (pull-payment) |
| `withdraw_treasury` | — | **new** (owner-only) |
| `get_stake_info` | — | **new** |
| `get_claimable` | — | **new** |
| `get_treasury` | — | **new** |
| `get_owner` | — | **new** |
| `get_stats` | 3 keys | 6 keys (adds disputes/staked/treasury) |

Method count: **8 → 14** (9 view, 5 write). Lint: green (`genvm-lint`, 3 checks).

## Why it matters — moves toward real usage

- **Spam and grief resistance.** Every claim now locks capital, and every dispute
  risks the challenger's own stake. Attacking the oracle is expensive and, in
  expectation, loss-making; honest use is capital-preserving (fee aside).
- **Aligned incentives.** Challenging is only rational when you genuinely expect
  the verdict to flip. This sharpens the adversarial verification the original
  design intended.
- **Sustainability.** The 5% protocol fee funds a treasury without charging
  honest, un-disputed submitters anything beyond a temporary stake lock — a path
  to a self-funding oracle.
- **Production-grade value handling.** Pull payments, checks-effects-interactions,
  a single-settlement invariant, and a proven value-conservation identity make
  the money paths safe against reentrancy, double-payout, and stuck funds.

## What did *not* change (backward compatibility)

- The verification and consensus pipeline (validation → per-source LLM analysis
  under `prompt_comparative` → confidence-weighted aggregation) is unchanged.
- `get_claim` returns the same keys as before; all economic data is exposed
  through the separate `get_stake_info` view, so existing integrations keep working.
- The status model (`verified`/`refuted`/`disputed`/`insufficient_sources`) is
  unchanged.

## How to verify the delta

```bash
# Lint (14 methods, 3 checks pass)
genvm-lint check contracts/fact_verifier.py

# Economic layer unit tests (new this milestone)
pytest tests/direct/test_staking.py -v          # 28 tests

# Full direct suite still green
pytest tests/direct/ -v                          # 120 tests

# End-to-end incl. finalize/withdraw + two-party dispute settlement
gltest tests/integration/test_fact_verifier.py -v -s   # 8 tests (needs Studio)
```

- **Code:** `contracts/fact_verifier.py` (staking params, payable methods,
  settlement, pull-payment withdrawals).
- **Tests:** `tests/direct/test_staking.py` (new, 28), updated
  `tests/integration/test_fact_verifier.py`.
- **Design:** [docs/economic-security.md](docs/economic-security.md) (new),
  plus updates to `architecture.md`, `consensus-design.md`, `security.md`.

## Steward resubmission (Nov 2026, un-deployed)

The Sep 15, 2026 steward request (Jaydeculein) asked for five fixes, all
implemented in this working tree and covered by direct tests
(`tests/direct/test_fact_verifier.py`, `tests/direct/test_staking.py`):

1. **Deployment parity** — see `docs/resubmission-evidence.md`. The current
   source is NOT the deployed bytecode, so a fresh Bradbury redeploy is
   required; the new address and deploy transaction will be published there
   after redeploy. Do not present the old milestone address as the address
   of this source.
2. **Payout primitive** — `_emit_payout()` uses the documented EOA transfer
   mechanism, records every payout as pending, rolls back synchronous
   emission failures immediately, and recovers asynchronous failures with the
   owner-only `recredit_failed_withdrawal()` after a 3600s delay.
3. **Challenge timing** — `dispute_claim` is now rejected after
   `submitted_at + 300`, matching `finalize_claim`, so the five-minute
   challenge window is closed on both sides.
4. **Frontend outcome** — writes wait for `FINALIZED` and then check
   `isSuccessful()`; a finalized-but-failed execution is surfaced as a
   failure, not a success.
5. **Trust boundary** — raw page content is fenced as untrusted data,
   boolean/confidence comparison is deterministic (exact boolean, confidence
   within 15), and source domains are unique across the whole claim
   lifecycle (submission + dispute).

Verification on this tree: `genvm-lint` passed, 99 direct tests passed,
frontend build passed, 8 `isSuccessful`/`isFinalized` unit tests passed.
Redeploy and the before/after balance evidence are still pending and need
the owner's wallet confirmation first.

## Steward resubmission: Studio Dev deployment (13 Nov 2026)

- Deployed the fixed source on Studio Dev (chain 61997) from the Studio Dev UI, deployer 0xC2Db6830C56e7b00f2d1970762f5c2D8b7812D0e.
- Contract: 0xD0C23F62660e68fF2A6D70369aF33CDE5822fe11, deploy tx 0x5bbd6a2e2c6ffb7978528aecc4c3c53321ae842634314f5b2b35c9c1eb7483fa, FINALIZED, gasless.
- Live get_stats confirms challenge_period_seconds 300 and owner 0xc2db.
- Bradbury Phase 2 redeploy still pending (faucet funding on hold).

## Steward follow-up: tracked confirm_withdrawal client flow (16 Nov 2026)

- Resubmission 294f4481 reviewed 16 Nov 2026, status Action needed, respond by 30 Nov 2026. Steward asked for a tracked client and user flow invoking the existing `confirm_withdrawal` after the recipient verifies a successful payout, clearing the pending record, without presenting parent-transaction finality as proof the async transfer completed.
- Built: `WithdrawalTracker` component (three tracked steps, confirm gated on balance-verified receipt), `getPendingWithdrawal` / `getNativeBalance` / `confirmWithdrawal` in the contract binding, `usePendingWithdrawal` / `useNativeBalance` (5s re-poll while pending) / `useConfirmWithdrawal` hooks, and the pure `verifyPayoutReceived` rule in `lib/contracts/withdrawal.ts`. `useWithdraw` no longer claims the balance was transferred on finality.
- Verification: `tsc --noEmit` passed; vitest 20 passed (12 withdrawal + 8 types); `next build` compiles, its TypeScript worker is SIGKILLed by the Boxs 1 GiB free RAM (reproduces on the clean tree, pre-existing). Docs updated in `docs/economic-security.md` and `docs/resubmission-evidence.md`.
- Still pending: Bradbury redeploy + full on-chain payout lifecycle evidence (faucet funding on hold).
