"use client";

import { useState, useEffect } from "react";
import { parseEther, formatEther } from "viem";
import { Plus, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { useSubmitClaim } from "@/lib/hooks/useFactVerifier";
import {
  MIN_SUBMISSION_STAKE_WEI,
  CLAIM_LIMITS,
  validateClaimText,
  validateSources,
} from "@/lib/contracts/FactVerifier";
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

const MIN_STAKE_GEN = formatEther(MIN_SUBMISSION_STAKE_WEI); // "0.01"

const textareaClass =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

const FEE_LEVELS: FeePresetLevel[] = ["low", "standard", "high"];

export function SubmitClaimModal() {
  const { isConnected } = useWallet();
  const { submitClaim, isSubmitting, isSuccess } = useSubmitClaim();

  const [open, setOpen] = useState(false);
  const [claim, setClaim] = useState("");
  const [sources, setSources] = useState<string[]>(["", ""]);
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");
  const [stake, setStake] = useState(MIN_STAKE_GEN);
  const [feeLevel, setFeeLevel] = useState<FeePresetLevel>("standard");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setClaim("");
    setSources(["", ""]);
    setCategory("");
    setContext("");
    setStake(MIN_STAKE_GEN);
    setFeeLevel("standard");
    setErrors({});
  };

  // Close and reset on successful submission
  useEffect(() => {
    if (isSuccess) {
      setOpen(false);
      resetForm();
    }
  }, [isSuccess]);

  // Close if the wallet disconnects
  useEffect(() => {
    if (!isConnected) setOpen(false);
  }, [isConnected]);

  const cleanedSources = () =>
    sources.map((s) => s.trim()).filter((s) => s.length > 0);

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    const claimErr = validateClaimText(claim.trim());
    if (claimErr) next.claim = claimErr;

    const srcErr = validateSources(cleanedSources());
    if (srcErr) next.sources = srcErr;

    if (!category.trim()) next.category = "Category cannot be empty";
    else if (category.length > CLAIM_LIMITS.MAX_CATEGORY_LENGTH)
      next.category = `Category exceeds ${CLAIM_LIMITS.MAX_CATEGORY_LENGTH} characters`;

    if (context.length > CLAIM_LIMITS.MAX_CONTEXT_LENGTH)
      next.context = `Context exceeds ${CLAIM_LIMITS.MAX_CONTEXT_LENGTH} characters`;

    let stakeWei: bigint | null = null;
    try {
      stakeWei = parseEther(stake as `${number}`);
    } catch {
      next.stake = "Enter a valid GEN amount";
    }
    if (stakeWei !== null && stakeWei < MIN_SUBMISSION_STAKE_WEI)
      next.stake = `Minimum stake is ${MIN_STAKE_GEN} GEN`;

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    submitClaim({
      claim: claim.trim(),
      sources: cleanedSources(),
      category: category.trim(),
      context: context.trim(),
      stakeWei: parseEther(stake as `${number}`),
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
        <Button variant="gradient" disabled={!isConnected}>
          <Plus className="w-4 h-4 mr-2" />
          Submit Claim
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-card border-2 sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Submit a claim
          </DialogTitle>
          <DialogDescription>
            Stake GEN and let the oracle fetch your sources and reach a verdict
            on-chain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Claim text */}
          <div className="space-y-1.5">
            <Label htmlFor="claim">Claim</Label>
            <textarea
              id="claim"
              rows={3}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="e.g. The speed of light is approximately 299,792,458 m/s"
              className={textareaClass}
              maxLength={CLAIM_LIMITS.MAX_CLAIM_LENGTH}
            />
            {errors.claim && (
              <p className="text-xs text-destructive">{errors.claim}</p>
            )}
          </div>

          {/* Sources */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Source URLs ({CLAIM_LIMITS.MIN_SOURCES}–{CLAIM_LIMITS.MAX_SOURCES}, distinct domains)</Label>
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

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. physics, finance, geography"
              maxLength={CLAIM_LIMITS.MAX_CATEGORY_LENGTH}
            />
            {errors.category && (
              <p className="text-xs text-destructive">{errors.category}</p>
            )}
          </div>

          {/* Context (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="context">Context (optional)</Label>
            <textarea
              id="context"
              rows={2}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Extra context to guide verification"
              className={textareaClass}
              maxLength={CLAIM_LIMITS.MAX_CONTEXT_LENGTH}
            />
            {errors.context && (
              <p className="text-xs text-destructive">{errors.context}</p>
            )}
          </div>

          {/* Stake */}
          <div className="space-y-1.5">
            <Label htmlFor="stake">Stake (GEN)</Label>
            <Input
              id="stake"
              type="number"
              step="0.01"
              min={MIN_STAKE_GEN}
              value={stake}
              onChange={(e) => setStake(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Locked against your claim. Minimum {MIN_STAKE_GEN} GEN. Reclaim it
              by finalizing if unchallenged.
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
            variant="gradient"
            className="w-full h-12 text-base"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Verifying on-chain…
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5 mr-2" />
                Stake &amp; verify
              </>
            )}
          </Button>
          {isSubmitting && (
            <p className="text-xs text-center text-muted-foreground">
              The oracle is fetching each source and running LLM analysis under
              the equivalence principle — this can take a little while.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
