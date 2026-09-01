"use client";

import { useState, useEffect } from "react";
import { parseEther, formatEther } from "viem";
import { Plus, Trash2, Loader2, Swords } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { useDisputeClaim } from "@/lib/hooks/useFactVerifier";
import { CLAIM_LIMITS, validateSources } from "@/lib/contracts/FactVerifier";
import type { FeePresetLevel } from "@/lib/genlayer/fees";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const FEE_LEVELS: FeePresetLevel[] = ["low", "standard", "high"];

export function DisputeModal({
  claimId,
  submissionStakeWei,
  disabled,
}: {
  claimId: string;
  submissionStakeWei: bigint | string;
  disabled?: boolean;
}) {
  const { isConnected } = useWallet();
  const { disputeClaim, isDisputing, isSuccess } = useDisputeClaim();

  const minStakeWei =
    typeof submissionStakeWei === "string"
      ? BigInt(submissionStakeWei)
      : submissionStakeWei;
  const minStakeGen = formatEther(minStakeWei);

  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<string[]>(["", ""]);
  const [stake, setStake] = useState(minStakeGen);
  const [feeLevel, setFeeLevel] = useState<FeePresetLevel>("standard");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSources(["", ""]);
    setStake(minStakeGen);
    setFeeLevel("standard");
    setErrors({});
  };

  // Close and reset on a settled dispute
  useEffect(() => {
    if (isSuccess) {
      setOpen(false);
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  // Close if the wallet disconnects
  useEffect(() => {
    if (!isConnected) setOpen(false);
  }, [isConnected]);

  const cleanedSources = () =>
    sources.map((s) => s.trim()).filter((s) => s.length > 0);

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    const srcErr = validateSources(cleanedSources());
    if (srcErr) next.sources = srcErr;

    let challengeWei: bigint | null = null;
    try {
      challengeWei = parseEther(stake as `${number}`);
    } catch {
      next.stake = "Enter a valid GEN amount";
    }
    if (challengeWei !== null && challengeWei < minStakeWei)
      next.stake = `Challenge must match or exceed the submission stake (${minStakeGen} GEN)`;

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    disputeClaim({
      claimId,
      sources: cleanedSources(),
      challengeWei: parseEther(stake as `${number}`),
      feePresetLevel: feeLevel,
    });
  };

  const updateSource = (i: number, value: string) => {
    setSources((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  };
  const addSource = () => {
    if (sources.length < CLAIM_LIMITS.MAX_SOURCES)
      setSources((prev) => [...prev, ""]);
  };
  const removeSource = (i: number) => {
    if (sources.length > CLAIM_LIMITS.MIN_SOURCES)
      setSources((prev) => prev.filter((_, idx) => idx !== i));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErrors({});
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          <Swords className="w-4 h-4 mr-2" />
          Dispute verdict
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-card border-2 sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Dispute {claimId}
          </DialogTitle>
          <DialogDescription>
            Stake against the current verdict with your own sources. Consensus is
            re-run over every source; the winner takes the loser&apos;s stake,
            minus the protocol fee.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Counter-sources */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>
                Counter-source URLs ({CLAIM_LIMITS.MIN_SOURCES}–
                {CLAIM_LIMITS.MAX_SOURCES}, distinct domains)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSource}
                disabled={sources.length >= CLAIM_LIMITS.MAX_SOURCES}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {sources.map((src, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={src}
                    onChange={(e) => updateSource(i, e.target.value)}
                    placeholder="https://…"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSource(i)}
                    disabled={sources.length <= CLAIM_LIMITS.MIN_SOURCES}
                    aria-label="Remove source"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
            {errors.sources && (
              <p className="text-xs text-destructive">{errors.sources}</p>
            )}
          </div>

          {/* Challenge stake */}
          <div className="space-y-1.5">
            <Label htmlFor="challenge-stake">Challenge stake (GEN)</Label>
            <Input
              id="challenge-stake"
              type="number"
              step="0.01"
              min={minStakeGen}
              value={stake}
              onChange={(e) => setStake(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Must match or exceed the submission stake of {minStakeGen} GEN.
            </p>
            {errors.stake && (
              <p className="text-xs text-destructive">{errors.stake}</p>
            )}
          </div>

          {/* Fee preset */}
          <div className="space-y-1.5">
            <Label>Validation effort (fee preset)</Label>
            <div className="grid grid-cols-3 gap-2">
              {FEE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFeeLevel(level)}
                  className={`px-3 py-2 rounded-md border text-sm capitalize transition-colors ${
                    feeLevel === level
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-white/10 text-muted-foreground hover:bg-white/5"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            variant="destructive"
            className="w-full h-12 text-base"
            disabled={isDisputing}
          >
            {isDisputing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Settling dispute…
              </>
            ) : (
              <>
                <Swords className="w-5 h-5 mr-2" />
                Stake &amp; challenge
              </>
            )}
          </Button>
          {isDisputing && (
            <p className="text-xs text-center text-muted-foreground">
              Consensus is being re-run over all sources under the equivalence
              principle — this can take a little while.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
