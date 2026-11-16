import { createClient } from "genlayer-js";
import { TransactionStatus } from "genlayer-js/types";
import { activeChain, getStudioUrl, getEthereumProvider } from "../genlayer/client";
import { isSuccessful } from "./types";
import type {
  Claim,
  ClaimStatus,
  SourceResult,
  StakeInfo,
  Stats,
  TransactionReceipt,
} from "./types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";

/** Minimum submission stake — mirrors MIN_SUBMISSION_STAKE (0.01 GEN). */
export const MIN_SUBMISSION_STAKE_WEI = 10n ** 16n;

/** Input limits — mirror the contract's validation constants exactly. */
export const CLAIM_LIMITS = {
  MIN_SOURCES: 2,
  MAX_SOURCES: 5,
  MAX_CLAIM_LENGTH: 1000,
  MAX_SOURCE_URL_LENGTH: 500,
  MAX_CONTEXT_LENGTH: 500,
  MAX_CATEGORY_LENGTH: 100,
} as const;

/** Prompt-injection markers the contract rejects in claim text. */
export const INJECTION_MARKERS = [
  "ignore previous",
  "ignore above",
  "disregard",
  "new instruction",
  "system prompt",
  "you are now",
  "forget everything",
  "override",
];

/** Extract the domain of a URL the same way the contract does. */
export function domainOf(url: string): string {
  try {
    return url.split("://")[1]?.split("/")[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

/**
 * Validate claim text client-side, mirroring `_validate_claim`.
 * @returns an error message, or null if valid.
 */
export function validateClaimText(claim: string): string | null {
  if (!claim || !claim.trim()) return "Claim text cannot be empty";
  if (claim.length > CLAIM_LIMITS.MAX_CLAIM_LENGTH)
    return `Claim exceeds maximum length of ${CLAIM_LIMITS.MAX_CLAIM_LENGTH}`;
  const lower = claim.toLowerCase();
  for (const marker of INJECTION_MARKERS) {
    if (lower.includes(marker)) return "Claim contains disallowed content";
  }
  return null;
}

/**
 * Validate a list of source URLs client-side, mirroring `_validate_sources`.
 * @returns an error message, or null if valid.
 */
export function validateSources(urls: string[]): string | null {
  if (urls.length < CLAIM_LIMITS.MIN_SOURCES)
    return `At least ${CLAIM_LIMITS.MIN_SOURCES} source URLs required`;
  if (urls.length > CLAIM_LIMITS.MAX_SOURCES)
    return `Maximum ${CLAIM_LIMITS.MAX_SOURCES} source URLs allowed`;
  const seen = new Set<string>();
  for (const url of urls) {
    if (!url || !url.trim()) return "Source URL cannot be empty";
    if (url.length > CLAIM_LIMITS.MAX_SOURCE_URL_LENGTH)
      return `Source URL exceeds maximum length of ${CLAIM_LIMITS.MAX_SOURCE_URL_LENGTH}`;
    if (!url.startsWith("http://") && !url.startsWith("https://"))
      return "Source URL must start with http:// or https://";
    const domain = domainOf(url);
    if (seen.has(domain)) return `Duplicate source domain: ${domain}`;
    seen.add(domain);
  }
  return null;
}

/** Recursively convert genlayer-js `Map` return values into plain objects. */
function decode(value: any): any {
  if (value instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of value.entries()) obj[k] = decode(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(decode);
  return value;
}

/** Coerce a decoded numeric/string value into a wei bigint. */
function toBigInt(value: any): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function toSourceResult(raw: any): SourceResult {
  const o = decode(raw) ?? {};
  return {
    url: String(o.url ?? ""),
    supports_claim: Boolean(o.supports_claim),
    confidence: Number(o.confidence ?? 0),
    evidence: String(o.evidence ?? ""),
    reasoning: String(o.reasoning ?? ""),
  };
}

function toClaim(raw: any): Claim {
  const o = decode(raw) ?? {};
  return {
    claim_id: String(o.claim_id ?? ""),
    claim_text: String(o.claim_text ?? ""),
    category: String(o.category ?? ""),
    submitter: String(o.submitter ?? ""),
    status: String(o.status ?? "pending") as ClaimStatus,
    consensus_score: Number(o.consensus_score ?? 0),
    source_count: Number(o.source_count ?? 0),
    sources_supporting: Number(o.sources_supporting ?? 0),
    sources_refuting: Number(o.sources_refuting ?? 0),
    final_reasoning: String(o.final_reasoning ?? ""),
    source_results: Array.isArray(o.source_results)
      ? o.source_results.map(toSourceResult)
      : [],
  };
}

function toStakeInfo(claimId: string, raw: any): StakeInfo {
  const o = decode(raw) ?? {};
  return {
    claim_id: claimId,
    stake: toBigInt(o.stake).toString(),
    challenger: String(o.challenger ?? ""),
    challenge_stake: toBigInt(o.challenge_stake).toString(),
    resolved: Boolean(o.resolved),
    winner: String(o.winner ?? ""),
    status: String(o.status ?? "pending") as ClaimStatus,
  };
}

function toStats(raw: any): Stats {
  const o = decode(raw) ?? {};
  return {
    total_claims: Number(o.total_claims ?? 0),
    total_verified: Number(o.total_verified ?? 0),
    total_refuted: Number(o.total_refuted ?? 0),
    total_disputes: Number(o.total_disputes ?? 0),
    total_staked: toBigInt(o.total_staked).toString(),
    treasury: toBigInt(o.treasury).toString(),
    owner: String(o.owner ?? ""),
    challenge_period_seconds: Number(o.challenge_period_seconds ?? 0),
  };
}

/**
 * FactVerifier — typed client for the GenLayer cross-source fact-verification
 * oracle. Reads work without a wallet; writes require a connected account and
 * are signed by the connected injected wallet (MetaMask, Rabby, …) that
 * genlayer-js drives through `window.ethereum` when `account` is set.
 */
class FactVerifier {
  private contractAddress: `0x${string}`;
  private client: any;
  private studioUrl?: string;

  constructor(
    contractAddress: string,
    address?: string | null,
    studioUrl?: string
  ) {
    this.contractAddress = contractAddress as `0x${string}`;
    this.studioUrl = studioUrl;

    const config: any = { chain: activeChain };
    if (address) {
      config.account = address as `0x${string}`;
      // Route signing through the wallet the user connected with (Rabby,
      // MetaMask, …) rather than genlayer-js's window.ethereum default.
      const provider = getEthereumProvider();
      if (provider) config.provider = provider;
    }
    config.endpoint = studioUrl || getStudioUrl();

    this.client = createClient(config);
  }

  updateAccount(address: string): void {
    const config: any = {
      chain: activeChain,
      account: address as `0x${string}`,
      endpoint: this.studioUrl || getStudioUrl(),
    };
    const provider = getEthereumProvider();
    if (provider) config.provider = provider;
    this.client = createClient(config);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Stats> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_stats",
      args: [],
    });
    return toStats(raw);
  }

  async getClaim(claimId: string): Promise<Claim> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_claim",
      args: [claimId],
    });
    return toClaim(raw);
  }

  /**
   * Enumerate every claim. Claim ids are contiguous `claim_1..claim_N` where
   * N == `get_stats().total_claims` (the counter only ever increments and
   * claims are never deleted), so we fetch them all in parallel.
   * @returns claims, newest first.
   */
  async getClaims(): Promise<Claim[]> {
    const stats = await this.getStats();
    const n = stats.total_claims;
    if (!n || n <= 0) return [];

    const ids = Array.from({ length: n }, (_, i) => `claim_${i + 1}`);
    const settled = await Promise.allSettled(
      ids.map((id) => this.getClaim(id))
    );

    const claims: Claim[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") claims.push(result.value);
      else console.error("Error fetching claim:", result.reason);
    }
    return claims.reverse();
  }

  async getStakeInfo(claimId: string): Promise<StakeInfo> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_stake_info",
      args: [claimId],
    });
    return toStakeInfo(claimId, raw);
  }

  async getClaimable(account: string | null): Promise<bigint> {
    if (!account) return 0n;
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_claimable",
      args: [account],
    });
    return toBigInt(raw);
  }

  /**
   * The callers emitted-but-unconfirmed payout, in wei.
   *
   * A nonzero value means a `withdraw()` was emitted and the asynchronous
   * EOA transfer has not been confirmed received yet. The recipient clears
   * it with `confirmWithdrawal()` only after verifying the payout actually
   * landed in their wallet balance (see `getNativeBalance`).
   */
  async getPendingWithdrawal(account: string | null): Promise<bigint> {
    if (!account) return 0n;
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_pending_withdrawal",
      args: [account],
    });
    return toBigInt(raw);
  }

  /**
   * The accounts native GEN balance, in wei.
   *
   * This is the ground truth for payout verification: an asynchronous
   * payout is confirmed received only when this balance has increased by
   * the pending amount. The parent `withdraw()` transaction reaching
   * finality proves only that the transfer was emitted, never that the
   * recipient received it.
   */
  async getNativeBalance(account: string | null): Promise<bigint> {
    if (!account) return 0n;
    return this.client.getBalance({ address: account as `0x${string}` });
  }

  async getTreasury(): Promise<bigint> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_treasury",
      args: [],
    });
    return toBigInt(raw);
  }

  async getOwner(): Promise<string> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_owner",
      args: [],
    });
    return String(raw ?? "");
  }

  // ── Fee estimation ─────────────────────────────────────────────────────────

  async estimateSubmitClaimFees(
    claim: string,
    sources: string[],
    category: string,
    context: string,
    stakeWei: bigint,
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "submit_claim",
        args: [claim, sources, category, context],
        value: stakeWei,
      },
      level
    );
  }

  async estimateDisputeClaimFees(
    claimId: string,
    sources: string[],
    challengeWei: bigint,
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "dispute_claim",
        args: [claimId, sources],
        value: challengeWei,
      },
      level
    );
  }

  async estimateFinalizeClaimFees(
    claimId: string,
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "finalize_claim",
        args: [claimId],
      },
      level
    );
  }

  async estimateWithdrawFees(
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "withdraw",
        args: [],
      },
      level
    );
  }

  async estimateConfirmWithdrawalFees(
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "confirm_withdrawal",
        args: [],
      },
      level
    );
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Wait for full finality, then assert the transaction actually executed
   * successfully. A FINALIZED receipt can still carry a failed execution
   * result, so lifecycle state alone is not a success signal.
   */
  private async waitForFinalizedSuccess(
    txHash: any,
    action: string
  ): Promise<TransactionReceipt> {
    const receipt = (await this.client.waitForTransactionReceipt({
      hash: txHash,
      // Wait for full finality so callers never see an ACCEPTED receipt that
      // later reverts during the appeal window.
      status: TransactionStatus.FINALIZED,
      retries: 60,
      interval: 5000,
    })) as TransactionReceipt;

    if (!isSuccessful(receipt)) {
      throw new Error(
        `${action} transaction ${String(txHash)} reached finality but did not execute successfully ` +
          `(status: ${receipt?.statusName ?? receipt?.status ?? "unknown"}, ` +
          `execution: ${receipt?.txExecutionResultName ?? receipt?.txExecutionResult ?? "unknown"}).`
      );
    }
    return receipt;
  }

  /**
   * Submit a claim with a stake (payable). The stake is sent as the call
   * value; the contract fetches every source and runs per-source LLM analysis
   * under the equivalence principle before returning.
   */
  async submitClaim(
    claim: string,
    sources: string[],
    category: string,
    context: string,
    stakeWei: bigint,
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "submit_claim",
        args: [claim, sources, category, context],
        value: stakeWei,
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Submit claim");
    } catch (error) {
      console.error("Error submitting claim:", error);
      throw error;
    }
  }

  /**
   * Dispute a verified/refuted claim with counter-sources (payable). The
   * challenge stake must be at least the original submission stake.
   */
  async disputeClaim(
    claimId: string,
    sources: string[],
    challengeWei: bigint,
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "dispute_claim",
        args: [claimId, sources],
        value: challengeWei,
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Dispute claim");
    } catch (error) {
      console.error("Error disputing claim:", error);
      throw error;
    }
  }

  /** Finalize an unchallenged claim (submitter only) to release the stake. */
  async finalizeClaim(
    claimId: string,
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "finalize_claim",
        args: [claimId],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Finalize claim");
    } catch (error) {
      console.error("Error finalizing claim:", error);
      throw error;
    }
  }

  /** Withdraw the caller's accumulated balance (pull-payment). */
  async withdraw(feePreset?: FeePresetEstimate): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "withdraw",
        args: [],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Withdraw");
    } catch (error) {
      console.error("Error withdrawing:", error);
      throw error;
    }
  }

  /**
   * Confirm receipt of an emitted payout and clear the pending record.
   *
   * Call this only after the recipient has verified, from their own wallet
   * balance, that the asynchronous transfer actually landed (see
   * `getNativeBalance`). The parent `withdraw()` transaction reaching
   * finality proves only that the transfer was emitted, never that the
   * recipient received it, so this method must never be invoked on the
   * strength of parent-transaction finality alone.
   */
  async confirmWithdrawal(
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "confirm_withdrawal",
        args: [],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Confirm withdrawal");
    } catch (error) {
      console.error("Error confirming withdrawal:", error);
      throw error;
    }
  }

  /** Withdraw accumulated protocol fees (owner only). */
  async withdrawTreasury(
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "withdraw_treasury",
        args: [],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      return this.waitForFinalizedSuccess(txHash, "Withdraw treasury");
    } catch (error) {
      console.error("Error withdrawing treasury:", error);
      throw error;
    }
  }
}

export default FactVerifier;
