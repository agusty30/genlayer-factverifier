# Steward fix — GenLayer FactVerifier resubmission

Submission: 72350fae-66b2-4437-8e94-615bf242497b, REJECTED Oct 29 2026.
Reason: No response to the request for more information within 14 days.
Project: FactVerifier, AI Fact-Checking Oracle on GenLayer, Bradbury testnet.
Repo: https://github.com/agusty30/genlayer-factverifier (this folder, branch main, clean).
Live contract in README: 0x0341797e201C1e697E89a199E6bC0e2e0bF5193a, Bradbury chainId 4221.
Note: MILESTONE.md also lists 0x65282cB9AA0D9a8AbbF61c0acEa20e334fed1680 as Accepted deployment.

## Steward request to fix — Jaydeculein, Sep 15 2026 (still open)

1. Deployment parity. Redeploy the current source and publish the new Bradbury address + deploy transaction, OR prove the existing address corresponds to the September source. Do NOT deploy yet: prepare the redeploy command and evidence checklist, stop before any signing or broadcast, and report what deploy needs.
2. Payout primitive. Use the documented EOA transfer mechanism, explicitly handle failed asynchronous transfers / recredit if necessary, and provide before/after wallet balance evidence. Current withdraw() uses gl.get_contract_at(sender).emit_transfer(value=amount) with checks-effects-interactions, but has no failed-transfer handling or recredit path.
3. Challenge timing, internally consistent. Either reject disputes after submitted_at + 300, or stop describing it as a closed five-minute challenge window. Current state: finalize_claim enforces the 300s wait, but dispute_claim has NO window check at all.
4. Frontend: use transaction outcome, not lifecycle state. waitForFinalization() plus isSuccessful() or equivalent. Current state: frontend/lib/contracts/FactVerifier.ts already waits for TransactionStatus.FINALIZED in 5 methods, but there is no isSuccessful() outcome check.
5. Harden the oracle trust boundary. Fence raw webpage/context content, adversarial-test source-page prompt injection, enforce source-domain uniqueness across the entire claim lifecycle (submission + dispute, not just submission), and consider replacing LLM-based comparison of boolean/numeric fields with deterministic custom validation.

## Earlier steward context (already partly done, do not regress)

- Aug 28 Jaydeculein: challenge period, dispute semantics, consensus-authoritative fields (supports_claim/confidence are consensus, evidence/reasoning explanatory-only), CI lint contracts/fact_verifier.py, frontend ACCEPTED vs FINALIZED.
- Sep 5 Gen. Dave: football-betting residue and ambiguous re-run wording. Sep 7 response deleted the failing football test and clarified wording. Verify no football residue or ambiguous wording remains.

## Task

1. Audit each Sep 15 item against current main and list done vs missing, with file and line references.
2. Implement the missing fixes in contracts/fact_verifier.py, frontend, docs, and tests. Add or update tests for: dispute after submitted_at+300 is rejected, payout failure/recredit, domain uniqueness across dispute, prompt-injection adversarial cases, frontend finalization outcome handling.
3. Update README, MILESTONE.md, docs/economic-security.md, docs/security.md, docs/consensus-design.md so wording, addresses, and challenge timing are consistent. Do not invent a new deployment address or transaction hash. If redeploy is needed, write the exact redeploy steps and the evidence to collect (new address, deploy tx, before/after balances) into docs/resubmission-evidence.md, and stop before deploying.
4. Run: contract lint, direct tests, frontend build. Report pass/fail per check. Do not commit, do not push, do not deploy, do not sign anything. Leave the working tree with the changes for review.
