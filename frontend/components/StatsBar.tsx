"use client";

import { formatEther } from "viem";
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  Swords,
  Coins,
  Landmark,
} from "lucide-react";
import { useStats } from "@/lib/hooks/useFactVerifier";

function formatGen(wei: bigint | string | undefined): string {
  if (wei === undefined || wei === null) return "0";
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  const gen = Number(formatEther(v));
  return gen.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function StatsBar() {
  const { data: stats } = useStats();

  const items = [
    {
      label: "Claims",
      value: stats ? stats.total_claims.toString() : "—",
      icon: FileCheck2,
      color: "text-accent",
    },
    {
      label: "Verified",
      value: stats ? stats.total_verified.toString() : "—",
      icon: CheckCircle2,
      color: "text-green-400",
    },
    {
      label: "Refuted",
      value: stats ? stats.total_refuted.toString() : "—",
      icon: XCircle,
      color: "text-destructive",
    },
    {
      label: "Disputes",
      value: stats ? stats.total_disputes.toString() : "—",
      icon: Swords,
      color: "text-yellow-400",
    },
    {
      label: "Staked (GEN)",
      value: stats ? formatGen(stats.total_staked) : "—",
      icon: Coins,
      color: "text-accent",
    },
    {
      label: "Treasury (GEN)",
      value: stats ? formatGen(stats.treasury) : "—",
      icon: Landmark,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="brand-card p-4 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className={`w-4 h-4 ${item.color}`} />
              <span className="text-xs uppercase tracking-wider">
                {item.label}
              </span>
            </div>
            <span className={`text-2xl font-bold ${item.color}`}>
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
