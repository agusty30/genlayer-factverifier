import type { GenLayerTransaction } from "genlayer-js/types";
import { TransactionStatus } from "genlayer-js/types";

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
  return receipt?.status === TransactionStatus.FINALIZED;
}

export function isAccepted(receipt: TransactionReceipt): boolean {
  return receipt?.status === TransactionStatus.ACCEPTED;
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
