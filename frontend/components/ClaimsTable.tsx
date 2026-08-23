"use client";

import { useState, type ComponentType } from "react";
import {
  Loader2,
  AlertCircle,
  FileSearch,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Swords,
  HelpCircle,
  Clock,
} from "lucide-react";
import { useClaims, useFactVerifierContract } from "@/lib/hooks/useFactVerifier";
import type { Claim, ClaimStatus } from "@/lib/contracts/types";
import { AddressDisplay } from "./AddressDisplay";
import { ClaimDetail } from "./ClaimDetail";

/** Visual metadata for each claim status. */
export const STATUS_META: Record<
  ClaimStatus,
  { label: string; className: string; icon: ComponentType<{ className?: string }> }
> = {
  verified: {
    label: "Verified",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
    icon: CheckCircle2,
  },
  refuted: {
    label: "Refuted",
    className: "bg-red-500/20 text-destructive border-red-500/30",
    icon: XCircle,
  },
  disputed: {
    label: "Disputed",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    icon: Swords,
  },
  insufficient_sources: {
    label: "Insufficient",
    className: "bg-white/10 text-muted-foreground border-white/20",
    icon: HelpCircle,
  },
  pending: {
    label: "Pending",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    icon: Clock,
  },
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {meta.label}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-card p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <FileSearch className="w-5 h-5 text-accent" />
        Claims
      </h2>
      {children}
    </div>
  );
}

export function ClaimsTable() {
  const contract = useFactVerifierContract();
  const { data: claims, isLoading, isError } = useClaims();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!contract) {
    return (
      <Panel>
        <div className="text-center py-12 space-y-3">
          <AlertCircle className="w-12 h-12 mx-auto text-yellow-400 opacity-60" />
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Setup Required</p>
            <p className="text-xs text-muted-foreground">
              Contract address not configured
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (isLoading) {
    return (
      <Panel>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel>
        <div className="text-center py-12">
          <p className="text-sm text-destructive">Failed to load claims</p>
        </div>
      </Panel>
    );
  }

  if (!claims || claims.length === 0) {
    return (
      <Panel>
        <div className="text-center py-16">
          <FileSearch className="w-12 h-12 mx-auto text-muted-foreground opacity-30 mb-3" />
          <p className="text-sm text-muted-foreground">No claims yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Submit the first claim to see it verified on-chain.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-white/10">
              <th className="py-3 pr-4 font-medium">Claim</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Consensus</th>
              <th className="py-3 px-4 font-medium">Submitter</th>
              <th className="py-3 pl-4 font-medium sr-only">Expand</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <ClaimRow
                key={claim.claim_id}
                claim={claim}
                expanded={expandedId === claim.claim_id}
                onToggle={() =>
                  setExpandedId((prev) =>
                    prev === claim.claim_id ? null : claim.claim_id
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ClaimRow({
  claim,
  expanded,
  onToggle,
}: {
  claim: Claim;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer align-top"
      >
        <td className="py-4 pr-4 max-w-xs">
          <p className="font-medium line-clamp-2">{claim.claim_text}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full">
              {claim.category}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {claim.claim_id}
            </span>
          </div>
        </td>
        <td className="py-4 px-4">
          <StatusBadge status={claim.status} />
        </td>
        <td className="py-4 px-4">
          <div className="font-semibold">{claim.consensus_score}/100</div>
          <div className="text-xs text-muted-foreground">
            <span className="text-green-400">{claim.sources_supporting}✓</span>
            {" / "}
            <span className="text-destructive">{claim.sources_refuting}✗</span>
            {" · "}
            {claim.source_count} src
          </div>
        </td>
        <td className="py-4 px-4">
          <AddressDisplay address={claim.submitter} maxLength={12} />
        </td>
        <td className="py-4 pl-4 text-right">
          <ChevronRight
            className={`w-4 h-4 inline-block text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-black/20">
          <td colSpan={5} className="p-0">
            <ClaimDetail claim={claim} />
          </td>
        </tr>
      )}
    </>
  );
}
