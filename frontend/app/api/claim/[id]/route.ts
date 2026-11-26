/**
 * GET /api/claim/<id> — poll the verdict of a claim submitted via /api/verify.
 *
 * Free (no x402 payment). Returns the full claim as stored on-chain:
 * status (pending/verified/refuted/disputed/insufficient_sources),
 * consensus_score, per-source results, and final reasoning.
 *
 * A claim id that does not exist yet (consensus failed, or the id was
 * derived before the tx was decided) returns 404 with status not_found.
 * Poll every ~15s; a verdict usually lands within 1-2 min of submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClaim } from "@/lib/genlayer/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^claim_\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid claim id" }, { status: 400 });
  }
  try {
    const claim = await getServerClaim(id);
    if (!claim) {
      return NextResponse.json(
        { error: "Claim not found", status: "not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json(claim);
  } catch (error) {
    console.error(`getServerClaim(${id}) failed:`, error);
    return NextResponse.json(
      { error: "Claim not found", status: "not_found" },
      { status: 404 }
    );
  }
}
