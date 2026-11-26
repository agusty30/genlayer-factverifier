/**
 * GET /api/verify — pay-per-verdict fact check (x402, $0.10 USDC, Base Sepolia).
 *
 * Flow:
 * 1. No payment header -> 402 with payment requirements (handled by withX402).
 * 2. Paid request -> withX402 verifies the payment with the facilitator,
 *    then this handler runs. If the handler returns < 400, the payment is
 *    settled; a 4xx/5xx response means the client is NOT charged.
 * 3. The handler validates the input, checks the sources are reachable,
 *    submits the claim to FactVerifier on GenLayer Studio Dev from the demo
 *    wallet, and returns the claim id + tx hash immediately. Consensus takes
 *    ~1-2 min; the client polls GET /api/claim/<id> for the verdict.
 *
 * Query params:
 * - claim (required): the statement to verify, max 1000 chars.
 * - sources (required, repeatable): 2-5 source URLs, unique domains.
 * - category (optional, default "general"): free-form, max 100 chars.
 * - context (optional, default ""): extra context, max 500 chars.
 *
 * Env (server-only): DEMO_PRIVATE_KEY (required), GENLAYER_RPC_URL,
 * FACT_VERIFIER_ADDRESS, X402_PAY_TO, X402_PRICE, X402_FACILITATOR_URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  validateClaimText,
  validateSources,
} from "@/lib/contracts/FactVerifier";
import { submitClaimServer } from "@/lib/genlayer/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAY_TO = (process.env.X402_PAY_TO ||
  "0x65cbf00EcD3D5c1091378A841f986997eFc42462") as `0x${string}`;
const PRICE = process.env.X402_PRICE || "$0.10";
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(
  "eip155:84532",
  new ExactEvmScheme()
);

/**
 * Best-effort reachability check for the source URLs.
 *
 * The GenLayer validators fetch every source during consensus, and a source
 * that refuses the fetch (e.g. Britannica 403) fails the whole claim even
 * after payment. This pre-check catches dead URLs before any charge; it
 * cannot guarantee the validator fetcher will succeed, so it is a gate,
 * not a promise.
 */
async function firstUnreachable(urls: string[]): Promise<string | null> {
  const checks = await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; FactVerifier-x402/1.0; +https://genlayer-factverifier.vercel.app)",
          },
          signal: AbortSignal.timeout(5000),
        });
        return res.ok ? null : `${u} returned HTTP ${res.status}`;
      } catch {
        return `${u} is unreachable`;
      }
    })
  );
  return checks.find((c) => c !== null) ?? null;
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const claim = url.searchParams.get("claim") ?? "";
  const sources = url.searchParams.getAll("sources");
  const category = url.searchParams.get("category") || "general";
  const context = url.searchParams.get("context") || "";

  if (category.length > 100) {
    return NextResponse.json(
      { error: "Category exceeds maximum length of 100" },
      { status: 400 }
    );
  }
  if (context.length > 500) {
    return NextResponse.json(
      { error: "Context exceeds maximum length of 500" },
      { status: 400 }
    );
  }
  const claimErr = validateClaimText(claim);
  if (claimErr) {
    return NextResponse.json({ error: claimErr }, { status: 400 });
  }
  const sourcesErr = validateSources(sources);
  if (sourcesErr) {
    return NextResponse.json({ error: sourcesErr }, { status: 400 });
  }

  const unreachable = await firstUnreachable(sources);
  if (unreachable) {
    return NextResponse.json(
      {
        error: `Source not fetchable, claim would fail consensus: ${unreachable}`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await submitClaimServer({
      claim,
      sources,
      category,
      context,
    });
    return NextResponse.json({
      claim_id: result.claimId,
      tx_hash: result.txHash,
      status: "submitted",
      stake_wei: result.stakeWei,
      fee_wei: result.feeWei,
      poll_url: `/api/claim/${result.claimId}`,
    });
  } catch (error) {
    console.error("submitClaimServer failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to submit claim";
    return NextResponse.json(
      { error: `Failed to submit claim to GenLayer: ${message}` },
      { status: 502 }
    );
  }
}

export const GET = withX402(
  handler,
  {
    accepts: [
      {
        scheme: "exact",
        price: PRICE,
        network: "eip155:84532",
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
      },
    ],
    description:
      "Pay-per-verdict fact check: one claim verified against 2-5 sources by GenLayer consensus (Internet Court demo).",
  },
  resourceServer
);
