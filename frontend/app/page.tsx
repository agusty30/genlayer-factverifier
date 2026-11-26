"use client";

import { Navbar } from "@/components/Navbar";
import { StatsBar } from "@/components/StatsBar";
import { ClaimsTable } from "@/components/ClaimsTable";
import { SubmitClaimModal } from "@/components/SubmitClaimModal";
import { ClaimablePanel } from "@/components/ClaimablePanel";
import {
  getContractAddress,
  getExplorerAddressUrl,
} from "@/lib/genlayer/client";

export default function HomePage() {
  const contractAddress = getContractAddress();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <Navbar />

      {/* Main Content - Padding to account for fixed navbar */}
      <main className="flex-grow pt-20 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Hero Section */}
          <div className="text-center animate-fade-in">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              <span className="text-gradient-purple-pink">
                FactVerifier
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              A cross-source fact-verification oracle on GenLayer.
              <br />
              Stake GEN on a claim, and the contract fetches your sources and
              reaches an AI verdict — live, on-chain.
            </p>
          </div>

          {/* Platform stats */}
          <div className="animate-slide-up">
            <StatsBar />
          </div>

          {/* Action row */}
          <div
            className="flex flex-col md:flex-row md:items-center gap-4 animate-slide-up"
            style={{ animationDelay: "80ms" }}
          >
            <div className="flex-1">
              <ClaimablePanel />
            </div>
            <div className="flex md:justify-end">
              <SubmitClaimModal />
            </div>
          </div>

          {/* Claims table */}
          <div className="animate-slide-up" style={{ animationDelay: "120ms" }}>
            <ClaimsTable />
          </div>

          {/* Info Section */}
          <div
            className="glass-card p-6 md:p-8 animate-fade-in"
            style={{ animationDelay: "200ms" }}
          >
            <h2 className="text-2xl font-bold mb-4">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">
                  1. Stake a claim
                </div>
                <p className="text-sm text-muted-foreground">
                  Connect your wallet, write a factual claim, and attach 2–5
                  source URLs from distinct domains. Lock GEN behind it as a
                  stake.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">
                  2. On-chain verdict
                </div>
                <p className="text-sm text-muted-foreground">
                  The Intelligent Contract fetches every source and runs LLM
                  analysis under the equivalence principle, recording a per-source
                  verdict and a consensus score on-chain.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">
                  3. Dispute or finalize
                </div>
                <p className="text-sm text-muted-foreground">
                  Disagree? Stake counter-sources to dispute — the winner takes
                  the loser&apos;s stake, minus a protocol fee. Unchallenged
                  submitters finalize and withdraw.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-3">
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {contractAddress && (
              <a
                href={getExplorerAddressUrl(contractAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent transition-colors font-mono text-xs"
              >
                Contract on Studio Dev explorer ↗
              </a>
            )}
            <a
              href="https://genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Powered by GenLayer
            </a>
            <a
              href="https://docs.genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Docs
            </a>
            <a
              href="https://github.com/genlayerlabs/genlayer-project-boilerplate"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
