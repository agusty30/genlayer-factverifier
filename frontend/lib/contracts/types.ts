import type { GenLayerTransaction } from "genlayer-js/types";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

/**
 * Re-export the SDK's GenLayerTransaction as the canonical receipt type for
 * the FactVerifier contract binding. It carries the full lifecycle status
 * (UNINITIALIZED → ... → ACCEPTED → FINALIZED), the block number, the
 * decoded call/deploy payload, and any consensus messages emitted by the
 * contract during execution.
 *
 * The Optimistic Democracy finality model has two important states:
 *   - ACCEPTED: validators have reached consensus, but the transaction is
 *     still in the appeal/finality window and could be challenged.
 *   - FINALIZED: the appeal window has elapsed; the transaction is final.
 *
 * For economically consequential operations (submitClaim, disputeClaim,
 * finalizeClaim, withdraw, withdrawTreasury) the binding waits for
 * FINALIZED so the caller never observes an ACCEPTED receipt that later
 * reverts.
 */
export type TransactionReceipt = GenLayerTransaction;

export { TransactionStatus };

/**
 * Predicate: did the receipt reach full finality? Use this in UI to
 * distinguish "Confirmed by validators" (ACCEPTED) from "Finalized on-chain"
 * (FINALIZED).
 */
export function isFinalized(receipt: TransactionReceipt): boolean {
  if (!receipt) return false;
  return (
    receipt.statusName === TransactionStatus.FINALIZED ||
    receipt.status === TransactionStatus.FINALIZED
  );
}

export function isAccepted(receipt: TransactionReceipt): boolean {
  if (!receipt) return false;
  return (
    receipt.statusName === TransactionStatus.ACCEPTED ||
    receipt.status === TransactionStatus.ACCEPTED
  );
}

/**
 * Predicate: did the transaction both reach finality AND execute successfully?
 *
 * Lifecycle state alone is not enough: a FINALIZED transaction can still carry
 * a failed execution result (for example, the contract reverted). The
 * authoritative outcome is `txExecutionResultName`; `txExecutionResult === 1`
 * is the numeric fallback for older receipts.
 */
export function isSuccessful(receipt: TransactionReceipt): boolean {
  if (!receipt || !isFinalized(receipt)) return false;
  if (receipt.txExecutionResultName) {
    return receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN;
  }
  return receipt.txExecutionResult === 1;
}

/** Human-readable outcome, for toasts and error messages. */
export function describeOutcome(receipt: TransactionReceipt): string {
  if (!receipt) return "unknown";
  if (!isFinalized(receipt)) return "not finalized";
  if (isSuccessful(receipt)) return "finalized and executed successfully";
  return `finalized but execution failed (${
    receipt.txExecutionResultName ?? receipt.txExecutionResult ?? "unknown"
  })`;
}

// ── Domain types ────────────────────────────────────────────────────────────

export type ClaimStatus =
  | "pending"
  | "verified"
  | "refuted"
  | "disputed"
  | "insufficient_sources";

export interface SourceResult {
  url: string;
  supports_claim: boolean;
  confidence: number;
  evidence: string;
  reasoning: string;
}

export interface Claim {
  claim_id: string;
  claim_text: string;
  category: string;
  submitter: string;
  status: ClaimStatus;
  consensus_score: number;
  source_count: number;
  sources_supporting: number;
  sources_refuting: number;
  final_reasoning: string;
  source_results: SourceResult[];
  submitted_at?: number; // epoch seconds; 0 for legacy claims
}

export interface StakeInfo {
  claim_id: string;
  stake: string; // wei bigint as string (Map decode)
  challenger: string;
  challenge_stake: string;
  resolved: boolean;
  winner: string;
  status?: ClaimStatus;
}

export interface Stats {
  total_claims: number;
  total_verified: number;
  total_refuted: number;
  total_disputes: number;
  total_staked: string; // wei bigint
  treasury: string; // wei bigint
  owner: string;
  challenge_period_seconds: number;
}
