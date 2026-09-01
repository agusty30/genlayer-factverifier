"use client";

import { formatEther } from "viem";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  CheckCheck,
  Trophy,
} from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { useStakeInfo, useFinalizeClaim } from "@/lib/hooks/useFactVerifier";
import { getExplorerAddressUrl } from "@/lib/genlayer/client";
import type { Claim } from "@/lib/contracts/types";
import { Button } from "./ui/button";
import { AddressDisplay } from "./AddressDisplay";
import { DisputeModal } from "./DisputeModal";

function gen(wei: bigint | string): string {
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  return `${Number(formatEther(v)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} GEN`;
}

export function ClaimDetail({ claim }: { claim: Claim }) {
  const { address, isConnected } = useWallet();
  const { data: stakeInfo } = useStakeInfo(claim.claim_id);
  const { finalizeClaim, isFinalizing, finalizingClaimId } = useFinalizeClaim();

  const isSubmitter =
    !!address &&
    !!claim.submitter &&
    address.toLowerCase() === claim.submitter.toLowerCase();

  const resolved = stakeInfo?.resolved ?? false;
  const disputable =
    !resolved && (claim.status === "verified" || claim.status === "refuted");

  return (
    <div className="p-6 space-y-6 border-t border-white/10">
      {/* Final reasoning */}
      {claim.final_reasoning && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Consensus reasoning
          </h4>
          <p className="text-sm text-foreground/90">{claim.final_reasoning}</p>
        </div>
      )}

      {/* Per-source analysis */}
      <div>
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Sources ({claim.source_results.length})
        </h4>
        <div className="space-y-3">
          {claim.source_results.map((src, i) => (
            <div key={i} className="brand-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline break-all inline-flex items-center gap-1"
                >
                  {src.url}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${
                    src.supports_claim
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-destructive"
                  }`}
                >
                  {src.supports_claim ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {src.supports_claim ? "Supports" : "Refutes"}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20">
                  Confidence
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full ${
                      src.supports_claim ? "bg-green-400" : "bg-destructive"
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(100, src.confidence))}%`,
                    }}
                  />
                </div>
                <span className="text-xs font-semibold w-10 text-right">
                  {src.confidence}%
                </span>
              </div>

              {src.evidence && (
                <p className="text-sm text-foreground/80">
                  <span className="text-muted-foreground">Evidence: </span>
                  {src.evidence}
                </p>
              )}
              {src.reasoning && (
                <p className="text-xs text-muted-foreground">{src.reasoning}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Economic / settlement state */}
      {stakeInfo && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Stake &amp; settlement
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="brand-card p-3">
              <p className="text-xs text-muted-foreground">Submission stake</p>
              <p className="font-semibold">{gen(stakeInfo.stake)}</p>
            </div>
            <div className="brand-card p-3">
              <p className="text-xs text-muted-foreground">Challenge stake</p>
              <p className="font-semibold">{gen(stakeInfo.challenge_stake)}</p>
            </div>
            <div className="brand-card p-3">
              <p className="text-xs text-muted-foreground">Challenger</p>
              {stakeInfo.challenger ? (
                <AddressDisplay address={stakeInfo.challenger} maxLength={12} />
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div className="brand-card p-3">
              <p className="text-xs text-muted-foreground">Resolved</p>
              <p className="font-semibold">{resolved ? "Yes" : "Open"}</p>
            </div>
          </div>

          {resolved && stakeInfo.winner && (
            <div className="mt-3 flex items-center gap-2 text-sm text-green-400">
              <Trophy className="w-4 h-4" />
              <span>Winner:</span>
              <a
                href={getExplorerAddressUrl(stakeInfo.winner)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                <AddressDisplay address={stakeInfo.winner} maxLength={14} />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {resolved ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCheck className="w-4 h-4" />
            This claim is settled and can no longer be disputed or finalized.
          </span>
        ) : (
          <>
            {disputable && stakeInfo && (
              <DisputeModal
                claimId={claim.claim_id}
                submissionStakeWei={stakeInfo.stake}
                disabled={!isConnected}
              />
            )}
            {isSubmitter && (
              <Button
                variant="secondary"
                onClick={() => finalizeClaim(claim.claim_id)}
                disabled={isFinalizing}
              >
                {isFinalizing && finalizingClaimId === claim.claim_id ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Finalizing…
                  </>
                ) : (
                  "Finalize & release stake"
                )}
              </Button>
            )}
            {!isConnected && disputable && (
              <span className="text-xs text-muted-foreground">
                Connect a wallet to dispute this verdict.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
