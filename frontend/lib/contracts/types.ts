/**
 * TypeScript types for the GenLayer FactVerifier contract.
 *
 * These mirror the dict/list shapes returned by the deployed Intelligent
 * Contract (contracts/fact_verifier.py). Amounts denominated in the native
 * token (GEN) are kept as `bigint` wei; small counters/scores are `number`.
 */

export type ClaimStatus =
  | "verified"
  | "refuted"
  | "disputed"
  | "insufficient_sources"
  | "pending";

/** One source's per-URL analysis, as returned inside `get_claim`. */
export interface SourceResult {
  url: string;
  supports_claim: boolean;
  confidence: number; // 0-100
  evidence: string;
  reasoning: string;
}

/** A verified claim — the shape of `get_claim(claim_id)`. */
export interface Claim {
  claim_id: string;
  claim_text: string;
  category: string;
  submitter: string;
  status: ClaimStatus;
  consensus_score: number; // 0-100
  source_count: number;
  sources_supporting: number;
  sources_refuting: number;
  final_reasoning: string;
  source_results: SourceResult[];
}

/** Economic state of a claim — the shape of `get_stake_info(claim_id)`. */
export interface StakeInfo {
  stake: bigint; // wei locked by the submitter
  challenger: string; // "" until disputed
  challenge_stake: bigint; // wei locked by the challenger
  resolved: boolean;
  winner: string; // "" until resolved
  status: ClaimStatus;
}

/** Platform totals — the shape of `get_stats()`. */
export interface Stats {
  total_claims: number;
  total_verified: number;
  total_refuted: number;
  total_disputes: number;
  total_staked: bigint; // wei currently locked in open claims
  treasury: bigint; // wei of accumulated protocol fees
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  blockNumber?: number;
  [key: string]: any;
}
