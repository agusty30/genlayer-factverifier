# Resubmission Evidence — Steward Request Sep 15, 2026

Submission: 72350fae-66b2-4437-8e94-615bf242497b (REJECTED Oct 29, 2026).
Steward: Jaydeculein, request dated Sep 15, 2026.

## 1. Deployment parity — REDEPLOY REQUIRED, NOT YET DONE

The current source in this tree is NOT the deployed bytecode. The live
Bradbury deployment in the README (`0x0341797e201C1e697E89a199E6bC0e2e0bF5193a`,
deploy tx `0xdde62d8c6940193f03d78d0ef4d1aca5dfd589399efe765d212f9955d2ddac55`)
predates the five steward fixes in this tree (challenge-window rejection in
`dispute_claim`, payout pending/recredit ledger, deterministic validator,
`isSuccessful()` frontend check, lifecycle domain uniqueness). Do NOT present
that address as the address of this source.

### Redeploy steps (do not run without the owner's wallet confirmation)

1. Confirm the deployer wallet and its Bradbury GEN balance (gas only).
2. `genlayer deploy` from the repo root (see `deploy/deployFactVerifier.ts`).
3. Record the new contract address and the deploy transaction hash.
4. Update `README.md`, `MILESTONE.md`, `frontend/README.md`, and
   `frontend/lib/genlayer/client.ts` (default contract address) to the new
   address. Leave the old milestone address in MILESTONE.md as history.
5. Verify on the Bradbury explorer that the new address shows the new
   deployment and that `get_stats` returns `challenge_period_seconds: 300`.

### Evidence to collect at redeploy

- New Bradbury contract address + explorer link
- Deploy transaction hash + explorer link
- Deployer address
- `get_stats` output from the new contract (proves the new code is live)

## 2. Payout primitive — implemented, on-chain evidence pending

`withdraw()` / `withdraw_treasury()` use the documented EOA transfer
mechanism (`_EoaRecipient(...).emit_transfer()`), record every payout in
`pending_withdrawals`, roll back synchronous emission failures into
`claimable` immediately, and recover asynchronous failures with the
owner-only `recredit_failed_withdrawal()` after `WITHDRAWAL_RECLAIM_DELAY_SECONDS`
(3600s). Recipients confirm receipt with `confirm_withdrawal()`.

Before/after wallet balance evidence for a real payout still has to be
collected on Bradbury after redeploy:

1. Submit a claim with a small stake, let a dispute settle it (or finalize
   an undisputed claim), then call `withdraw()`.
2. Record the recipient wallet balance before the `withdraw()` transaction
   and after it confirms, plus the transaction hash.
3. Record `get_claimable` and `get_pending_withdrawal` for the recipient
   before and after, and the `confirm_withdrawal()` call.

## 3. Challenge timing — implemented and tested

`dispute_claim` rejects disputes after `submitted_at + 300` and
`finalize_claim` refuses before it. Tests: `TestChallengeWindow`
(`test_dispute_after_challenge_period_rejected`,
`test_dispute_at_exact_boundary_rejected`,
`test_dispute_just_before_boundary_allowed`, plus the finalize timing tests
in `TestFinalize`).

## 4. Frontend outcome — implemented and tested

All five write methods wait for `TransactionStatus.FINALIZED` and then check
`isSuccessful(receipt)`; a finalized-but-failed execution is surfaced as a
failure. Tests: `frontend/lib/contracts/types.test.ts` (8 tests, vitest).

## 5. Trust boundary — implemented and tested

Raw page content is fenced as `<<<UNTRUSTED_*>>>` data; the equivalence
validator compares `supports_claim` exactly and `confidence` within 15
points deterministically; source domains are unique across the whole claim
lifecycle. Tests: `TestOracleTrustBoundary`, `TestDeterministicValidation`.

## Verification run on this tree (Nov 10, 2026)

- `genvm-lint check contracts/fact_verifier.py`: passed (3 checks)
- `pytest tests/direct/ -v`: 99 passed
- `npm run build` (frontend): compiled successfully, TypeScript passed
- `npx vitest run lib/contracts/types.test.ts`: 8 passed

## Studio Dev deployment (13 Nov 2026, chain 61997)

The fixed source was deployed from the Studio Dev UI (studio-dev.genlayer.com) with wallet 0xC2Db6830C56e7b00f2d1970762f5c2D8b7812D0e (BURNER).

- Contract address: 0xD0C23F62660e68fF2A6D70369aF33CDE5822fe11
- Deploy transaction: 0x5bbd6a2e2c6ffb7978528aecc4c3c53321ae842634314f5b2b35c9c1eb7483fa
- Status: FINALIZED (consensus PROPOSING, COMMITTING, REVEALING, ACCEPTED, FINALIZED; receipt status 0x1)
- Gas: gasless (effectiveGasPrice 0, gasUsed 0x7a1200)
- Explorer: https://explorer-studio-dev.genlayer.com/address/0xD0C23F62660e68fF2A6D70369aF33CDE5822fe11
- Live get_stats: challenge_period_seconds 300, min_submission_stake 10000000000000000 (0.01 GEN), owner 0xC2Db6830C56e7b00f2d1970762f5c2D8b7812D0e, protocol_fee_bps 500, total_claims 0, total_disputes 0, total_refuted 0, total_staked 0, total_verified 0, treasury 0

Note: this is a Studio Dev deployment (chain 61997), not Bradbury Phase 2 (chain 4221). The Bradbury redeploy and the on-chain payout before/after evidence are still pending the Phase 2 faucet funding (0.01 ETH on Ethereum mainnet for wallet 0xc2db).
