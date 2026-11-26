/**
 * Server-only GenLayer client for the x402 pay-per-verdict API.
 *
 * This module runs ONLY on the server (route handlers). It signs with the
 * demo wallet's private key from the `DEMO_PRIVATE_KEY` server env var,
 * which must never be committed, logged, or exposed to the browser.
 *
 * Proven facts (26 Nov 2026, genlayer-js 2.1.0, Studio Dev chain 61997):
 * - Use the bundled `studioDevnet` chain. Do NOT synthesize a chain from
 *   `studionet`: a hand-built chain lacks the consensus defaults and the
 *   write encoding fails. The v2 docs warn the same.
 * - Fees: plain `estimateTransactionFees({ appealRounds: 1n, rotations: [0n, 0n] })`
 *   returns ~0.075 GEN. The simulation-based estimator
 *   (`estimateTransactionFeesForWrite` / `estimateTransactionFeesFromSimulation`)
 *   fails on Studio Dev (`sim_estimateTransactionFees` internal error).
 * - Sources must be fetchable by the GenLayer web fetcher. A 403 (e.g.
 *   Britannica) makes the leader exit with code 1, validators disagree,
 *   and the tx ends FINISHED_WITH_ERROR with no claim created (the fee is
 *   still consumed). Wikipedia-class sources work.
 * - A submit takes ~1-2 min to reach a verdict; the API returns the claim
 *   id + tx hash immediately and the client polls GET /api/claim/<id>.
 */

import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

/** GenLayer RPC for the server client. Defaults to Studio Dev. */
export const SERVER_RPC_URL =
  process.env.GENLAYER_RPC_URL || "https://studio-dev.genlayer.com/api";

/** FactVerifier contract the server submits claims to. */
export const SERVER_CONTRACT_ADDRESS = (
  process.env.FACT_VERIFIER_ADDRESS ||
  "0xD0C23F62660e68fF2A6D70369aF33CDE5822fe11"
) as `0x${string}`;

/** Minimum submission stake, mirrors MIN_SUBMISSION_STAKE (0.01 GEN). */
export const SERVER_MIN_STAKE_WEI = 10n ** 16n;

/** Standard fee preset: 1 appeal round, no rotations (fee ~0.075 GEN). */
const FEE_OPTIONS: { appealRounds: bigint; rotations: bigint[] } = {
  appealRounds: 1n,
  rotations: [0n, 0n],
};

let serverClient: ReturnType<typeof createClient> | null = null;

/**
 * The server GenLayer client, signed by the demo wallet.
 * @throws if DEMO_PRIVATE_KEY is not set.
 */
export function getServerClient() {
  if (serverClient) return serverClient;
  const rawKey = process.env.DEMO_PRIVATE_KEY;
  if (!rawKey) {
    throw new Error("DEMO_PRIVATE_KEY is not set");
  }
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = createAccount(key);
  serverClient = createClient({
    chain: studioDevnet,
    endpoint: SERVER_RPC_URL,
    account,
  });
  return serverClient;
}

/** The demo wallet address derived from DEMO_PRIVATE_KEY, or null if unset. */
export function getServerWalletAddress(): string | null {
  const rawKey = process.env.DEMO_PRIVATE_KEY;
  if (!rawKey) return null;
  try {
    const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
    return createAccount(key).address;
  } catch {
    return null;
  }
}

/** Recursively convert genlayer-js `Map` return values into plain objects. */
function decode(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) obj[String(k)] = decode(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(decode);
  return value;
}

function toBigInt(value: unknown): bigint {
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

export type ServerClaim = {
  claim_id: string;
  claim_text: string;
  category: string;
  submitter: string;
  status: string;
  consensus_score: number;
  source_count: number;
  sources_supporting: number;
  sources_refuting: number;
  final_reasoning: string;
  source_results: Array<{
    url: string;
    supports_claim: boolean;
    confidence: number;
    evidence: string;
    reasoning: string;
  }>;
};

function toServerClaim(raw: unknown): ServerClaim | null {
  const o = (decode(raw) ?? {}) as Record<string, unknown>;
  if (!o.claim_id) return null;
  const results = Array.isArray(o.source_results) ? o.source_results : [];
  return {
    claim_id: String(o.claim_id ?? ""),
    claim_text: String(o.claim_text ?? ""),
    category: String(o.category ?? ""),
    submitter: String(o.submitter ?? ""),
    status: String(o.status ?? "pending"),
    consensus_score: Number(o.consensus_score ?? 0),
    source_count: Number(o.source_count ?? 0),
    sources_supporting: Number(o.sources_supporting ?? 0),
    sources_refuting: Number(o.sources_refuting ?? 0),
    final_reasoning: String(o.final_reasoning ?? ""),
    source_results: results.map((r) => {
      const s = (decode(r) ?? {}) as Record<string, unknown>;
      return {
        url: String(s.url ?? ""),
        supports_claim: Boolean(s.supports_claim),
        confidence: Number(s.confidence ?? 0),
        evidence: String(s.evidence ?? ""),
        reasoning: String(s.reasoning ?? ""),
      };
    }),
  };
}

/** Current contract stats (total_claims drives the next claim id). */
export async function getServerStats(): Promise<{ total_claims: number }> {
  const client = getServerClient();
  const raw = await client.readContract({
    address: SERVER_CONTRACT_ADDRESS,
    functionName: "get_stats",
    args: [],
  });
  const o = (decode(raw) ?? {}) as Record<string, unknown>;
  return { total_claims: Number(o.total_claims ?? 0) };
}

/** Read one claim by id. Returns null when the id does not exist (yet). */
export async function getServerClaim(claimId: string): Promise<ServerClaim | null> {
  const client = getServerClient();
  const raw = await client.readContract({
    address: SERVER_CONTRACT_ADDRESS,
    functionName: "get_claim",
    args: [claimId],
  });
  return toServerClaim(raw);
}

export type SubmitClaimResult = {
  claimId: string;
  txHash: string;
  stakeWei: string;
  feeWei: string;
};

/**
 * Submit a claim from the demo wallet and return immediately with the
 * claim id + tx hash. Consensus takes ~1-2 min; the caller polls
 * GET /api/claim/<id> for the verdict.
 *
 * The claim id is derived from `get_stats().total_claims + 1` read just
 * before the write (claim ids are contiguous `claim_1..claim_N`). This is
 * exact for sequential traffic; concurrent submissions can race by one.
 */
export async function submitClaimServer(input: {
  claim: string;
  sources: string[];
  category: string;
  context: string;
}): Promise<SubmitClaimResult> {
  const client = getServerClient();

  const stats = await getServerStats();
  const claimId = `claim_${stats.total_claims + 1}`;

  const fees = await client.estimateTransactionFees(FEE_OPTIONS);

  const txHash = await client.writeContract({
    address: SERVER_CONTRACT_ADDRESS,
    functionName: "submit_claim",
    args: [input.claim, input.sources, input.category, input.context],
    value: SERVER_MIN_STAKE_WEI,
    fees,
  });

  return {
    claimId,
    txHash: String(txHash),
    stakeWei: SERVER_MIN_STAKE_WEI.toString(),
    feeWei: String((fees as { feeValue?: bigint | string })?.feeValue ?? ""),
  };
}
