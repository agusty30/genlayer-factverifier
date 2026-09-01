"use client";

import { formatEther } from "viem";
import { Loader2, Wallet, Landmark } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  useClaimable,
  useOwner,
  useStats,
  useWithdraw,
  useWithdrawTreasury,
} from "@/lib/hooks/useFactVerifier";
import { Button } from "./ui/button";

function gen(wei: bigint | string | undefined | null): string {
  if (wei === undefined || wei === null) return "0";
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  return Number(formatEther(v)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

export function ClaimablePanel() {
  const { address, isConnected } = useWallet();
  const { data: claimable = 0n } = useClaimable(address);
  const { data: owner } = useOwner();
  const { data: stats } = useStats();
  const { withdraw, isWithdrawing } = useWithdraw();
  const { withdrawTreasury, isWithdrawing: isWithdrawingTreasury } =
    useWithdrawTreasury();

  if (!isConnected) return null;

  const isOwner =
    !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const treasury = stats?.treasury ?? 0n;

  return (
    <div className="brand-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-5 h-5 text-accent" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Withdrawable
          </p>
          <p className="text-xl font-bold text-accent">{gen(claimable)} GEN</p>
        </div>
      </div>

      <Button
        variant="gradient"
        onClick={() => withdraw()}
        disabled={isWithdrawing || claimable === 0n}
        className="sm:ml-auto"
      >
        {isWithdrawing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Withdrawing…
          </>
        ) : (
          "Withdraw"
        )}
      </Button>

      {isOwner && (
        <div className="flex items-center gap-3 sm:border-l sm:border-white/10 sm:pl-4">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Treasury
              </p>
              <p className="text-sm font-semibold">{gen(treasury)} GEN</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => withdrawTreasury()}
            disabled={isWithdrawingTreasury || treasury === 0n}
          >
            {isWithdrawingTreasury ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Sweep fees"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
