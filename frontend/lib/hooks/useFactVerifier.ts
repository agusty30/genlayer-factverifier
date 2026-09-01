"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import FactVerifier from "../contracts/FactVerifier";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import type { FeePresetLevel } from "../genlayer/fees";
import { useWallet } from "../genlayer/wallet";
import { success, error, configError } from "../utils/toast";
import type { Claim, StakeInfo, Stats, TransactionReceipt } from "../contracts/types";
import { isFinalized } from "../contracts/types";

/**
 * Get the FactVerifier contract instance.
 *
 * Returns null only if no contract address is configured. The instance is
 * recreated whenever the wallet address changes so genlayer-js is bound to the
 * current account. Reads work without a wallet; writes require one.
 */
export function useFactVerifierContract(): FactVerifier | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();

  const contract = useMemo(() => {
    if (!contractAddress) {
      configError(
        "Setup Required",
        "Contract address not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file."
      );
      return null;
    }
    return new FactVerifier(contractAddress, address, studioUrl);
  }, [contractAddress, address, studioUrl]);

  return contract;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Platform totals (claims / verified / refuted / disputes / staked / treasury). */
export function useStats() {
  const contract = useFactVerifierContract();

  return useQuery<Stats | null, Error>({
    queryKey: ["stats"],
    queryFn: () => (contract ? contract.getStats() : Promise.resolve(null)),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract,
  });
}

/** All claims, newest first. */
export function useClaims() {
  const contract = useFactVerifierContract();

  return useQuery<Claim[], Error>({
    queryKey: ["claims"],
    queryFn: () => (contract ? contract.getClaims() : Promise.resolve([])),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract,
  });
}

/** A single claim's economic state. */
export function useStakeInfo(claimId: string | null) {
  const contract = useFactVerifierContract();

  return useQuery<StakeInfo | null, Error>({
    queryKey: ["stakeInfo", claimId],
    queryFn: () =>
      contract && claimId
        ? contract.getStakeInfo(claimId)
        : Promise.resolve(null),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract && !!claimId,
  });
}

/** The connected wallet's withdrawable (pull-payment) balance, in wei. */
export function useClaimable(address: string | null) {
  const contract = useFactVerifierContract();

  return useQuery<bigint, Error>({
    queryKey: ["claimable", address],
    queryFn: () =>
      contract && address
        ? contract.getClaimable(address)
        : Promise.resolve(0n),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract && !!address,
  });
}

/** The contract owner (fee recipient). */
export function useOwner() {
  const contract = useFactVerifierContract();

  return useQuery<string, Error>({
    queryKey: ["owner"],
    queryFn: () => (contract ? contract.getOwner() : Promise.resolve("")),
    staleTime: 60000,
    enabled: !!contract,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["stats"] });
  queryClient.invalidateQueries({ queryKey: ["claims"] });
  queryClient.invalidateQueries({ queryKey: ["stakeInfo"] });
  queryClient.invalidateQueries({ queryKey: ["claimable"] });
  queryClient.invalidateQueries({ queryKey: ["owner"] });
}

/** Submit a staked claim. */
export function useSubmitClaim() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({
      claim,
      sources,
      category,
      context,
      stakeWei,
      feePresetLevel,
    }: {
      claim: string;
      sources: string[];
      category: string;
      context: string;
      stakeWei: bigint;
      feePresetLevel?: FeePresetLevel;
    }) => {
      if (!contract) {
        throw new Error(
          "Contract not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file."
        );
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to submit a claim."
        );
      }
      setIsSubmitting(true);
      const feePreset = await contract.estimateSubmitClaimFees(
        claim,
        sources,
        category,
        context,
        stakeWei,
        feePresetLevel ?? "standard"
      );
      return contract.submitClaim(
        claim,
        sources,
        category,
        context,
        stakeWei,
        feePreset
      );
    },
    onSuccess: (receipt: TransactionReceipt) => {
      invalidateAll(queryClient);
      setIsSubmitting(false);
      success(
        isFinalized(receipt)
          ? "Claim submitted & finalized!"
          : "Claim submitted (awaiting finality)",
        {
          description: isFinalized(receipt)
            ? "The oracle fetched your sources and the transaction is final on-chain."
            : "Validators reached consensus; waiting for the finality window.",
        }
      );
    },
    onError: (err: any) => {
      console.error("Error submitting claim:", err);
      setIsSubmitting(false);
      error("Failed to submit claim", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isSubmitting,
    submitClaim: mutation.mutate,
    submitClaimAsync: mutation.mutateAsync,
  };
}

/** Dispute a verified/refuted claim with counter-sources. */
export function useDisputeClaim() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isDisputing, setIsDisputing] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({
      claimId,
      sources,
      challengeWei,
      feePresetLevel,
    }: {
      claimId: string;
      sources: string[];
      challengeWei: bigint;
      feePresetLevel?: FeePresetLevel;
    }) => {
      if (!contract) {
        throw new Error("Contract not configured.");
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to dispute a claim."
        );
      }
      setIsDisputing(true);
      const feePreset = await contract.estimateDisputeClaimFees(
        claimId,
        sources,
        challengeWei,
        feePresetLevel ?? "standard"
      );
      return contract.disputeClaim(claimId, sources, challengeWei, feePreset);
    },
    onSuccess: (receipt: TransactionReceipt) => {
      invalidateAll(queryClient);
      setIsDisputing(false);
      success(
        isFinalized(receipt) ? "Dispute settled (finalized)!" : "Dispute recorded (awaiting finality)",
        {
          description: isFinalized(receipt)
            ? "Consensus validated the new evidence and stakes were settled."
            : "Dispute accepted by validators; awaiting finality.",
        }
      );
    },
    onError: (err: any) => {
      console.error("Error disputing claim:", err);
      setIsDisputing(false);
      error("Failed to dispute claim", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isDisputing,
    disputeClaim: mutation.mutate,
    disputeClaimAsync: mutation.mutateAsync,
  };
}

/** Finalize an unchallenged claim (submitter only). */
export function useFinalizeClaim() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizingClaimId, setFinalizingClaimId] = useState<string | null>(
    null
  );

  const mutation = useMutation({
    mutationFn: async (claimId: string) => {
      if (!contract) {
        throw new Error("Contract not configured.");
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to finalize a claim."
        );
      }
      setIsFinalizing(true);
      setFinalizingClaimId(claimId);
      const feePreset = await contract.estimateFinalizeClaimFees(claimId);
      return contract.finalizeClaim(claimId, feePreset);
    },
    onSuccess: (receipt: TransactionReceipt) => {
      invalidateAll(queryClient);
      setIsFinalizing(false);
      setFinalizingClaimId(null);
      success(
        isFinalized(receipt) ? "Claim finalized!" : "Finalization recorded (awaiting finality)",
        {
          description: isFinalized(receipt)
            ? "Your stake is now withdrawable."
            : "Finalization accepted by validators; awaiting finality.",
        }
      );
    },
    onError: (err: any) => {
      console.error("Error finalizing claim:", err);
      setIsFinalizing(false);
      setFinalizingClaimId(null);
      error("Failed to finalize claim", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isFinalizing,
    finalizingClaimId,
    finalizeClaim: mutation.mutate,
    finalizeClaimAsync: mutation.mutateAsync,
  };
}

/** Withdraw the caller's accumulated balance (pull-payment). */
export function useWithdraw() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!contract) {
        throw new Error("Contract not configured.");
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to withdraw."
        );
      }
      setIsWithdrawing(true);
      const feePreset = await contract.estimateWithdrawFees();
      return contract.withdraw(feePreset);
    },
    onSuccess: (receipt: TransactionReceipt) => {
      invalidateAll(queryClient);
      setIsWithdrawing(false);
      success(
        isFinalized(receipt) ? "Withdrawal complete!" : "Withdrawal recorded (awaiting finality)",
        {
          description: isFinalized(receipt)
            ? "Your balance has been transferred to your wallet."
            : "Withdrawal accepted by validators; awaiting finality.",
        }
      );
    },
    onError: (err: any) => {
      console.error("Error withdrawing:", err);
      setIsWithdrawing(false);
      error("Failed to withdraw", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isWithdrawing,
    withdraw: mutation.mutate,
    withdrawAsync: mutation.mutateAsync,
  };
}

/** Withdraw accumulated protocol fees (owner only). */
export function useWithdrawTreasury() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!contract) {
        throw new Error("Contract not configured.");
      }
      if (!address) {
        throw new Error("Wallet not connected.");
      }
      setIsWithdrawing(true);
      return contract.withdrawTreasury();
    },
    onSuccess: () => {
      invalidateAll(queryClient);
      setIsWithdrawing(false);
      success("Treasury withdrawn!", {
        description: "Protocol fees have been transferred to the owner.",
      });
    },
    onError: (err: any) => {
      console.error("Error withdrawing treasury:", err);
      setIsWithdrawing(false);
      error("Failed to withdraw treasury", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isWithdrawing,
    withdrawTreasury: mutation.mutate,
    withdrawTreasuryAsync: mutation.mutateAsync,
  };
}
