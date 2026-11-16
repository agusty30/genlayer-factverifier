"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import FactVerifier from "../contracts/FactVerifier";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import type { FeePresetLevel } from "../genlayer/fees";
import { useWallet } from "../genlayer/wallet";
import { success, error, configError } from "../utils/toast";
import type { Claim, StakeInfo, Stats, TransactionReceipt } from "../contracts/types";
import { isSuccessful } from "../contracts/types";
import {
  clearWithdrawalRecord,
  saveWithdrawalRecord,
  type WithdrawalRecord,
} from "../contracts/withdrawal";

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

/**
 * The connected wallets emitted-but-unconfirmed payout, in wei.
 *
 * Nonzero while a `withdraw()` transfer is still awaiting receipt
 * confirmation. Cleared only by `confirmWithdrawal()` after the recipient
 * verifies the payout landed in their wallet balance.
 */
export function usePendingWithdrawal(address: string | null) {
  const contract = useFactVerifierContract();

  return useQuery<bigint, Error>({
    queryKey: ["pendingWithdrawal", address],
    queryFn: () =>
      contract && address
        ? contract.getPendingWithdrawal(address)
        : Promise.resolve(0n),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract && !!address,
  });
}

/**
 * The connected wallets native GEN balance, in wei.
 *
 * This is the ground truth for payout verification. While a withdrawal is
 * pending, the balance is re-polled every 5 seconds so the tracker can
 * detect the moment the asynchronous transfer lands.
 */
export function useNativeBalance(
  address: string | null,
  pollWhilePending = false
) {
  const contract = useFactVerifierContract();

  return useQuery<bigint, Error>({
    queryKey: ["nativeBalance", address],
    queryFn: () =>
      contract && address
        ? contract.getNativeBalance(address)
        : Promise.resolve(0n),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    refetchInterval: pollWhilePending ? 5000 : false,
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
  queryClient.invalidateQueries({ queryKey: ["pendingWithdrawal"] });
  queryClient.invalidateQueries({ queryKey: ["nativeBalance"] });
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
        isSuccessful(receipt)
          ? "Claim submitted & finalized!"
          : "Claim submitted (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "The oracle fetched your sources and the transaction executed successfully on-chain."
            : "The transaction reached finality without a successful execution result.",
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
        isSuccessful(receipt)
          ? "Dispute settled (finalized)!"
          : "Dispute recorded (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "Consensus validated the new evidence and stakes were settled."
            : "The transaction reached finality without a successful execution result.",
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
        isSuccessful(receipt)
          ? "Claim finalized!"
          : "Finalization recorded (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "Your stake is now withdrawable."
            : "The transaction reached finality without a successful execution result.",
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

/**
 * Withdraw the caller's accumulated balance (pull-payment).
 *
 * The payout is asynchronous: `withdraw()` only EMITS the transfer. The
 * parent transaction reaching finality does NOT prove the recipient
 * received the funds, so the success toast deliberately does not claim a
 * completed transfer. Instead, the hook captures the recipients native
 * balance BEFORE the withdraw and records it (with the withdrawn amount)
 * so the WithdrawalTracker can verify receipt from the actual balance
 * growth and then offer `confirmWithdrawal()`.
 */
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
      // Capture the baseline BEFORE the transfer is emitted: the tracker
      // proves receipt by comparing this against the balance afterwards.
      const baselineWei = await contract.getNativeBalance(address);
      const amountWei = await contract.getClaimable(address);
      const feePreset = await contract.estimateWithdrawFees();
      const receipt = await contract.withdraw(feePreset);
      return { receipt, baselineWei, amountWei };
    },
    onSuccess: ({ receipt, baselineWei, amountWei }) => {
      invalidateAll(queryClient);
      setIsWithdrawing(false);
      if (isSuccessful(receipt) && address) {
        const record: WithdrawalRecord = {
          address,
          baselineWei: baselineWei.toString(),
          amountWei: amountWei.toString(),
          txHash: String(
            (receipt as any)?.hash ??
              (receipt as any)?.transactionHash ??
              ""
          ),
          emittedAt: Math.floor(Date.now() / 1000),
        };
        saveWithdrawalRecord(record);
      }
      success(
        isSuccessful(receipt)
          ? "Withdrawal emitted, receipt not yet verified"
          : "Withdrawal recorded (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "The transfer was emitted. It is NOT confirmed received until your wallet balance grows by the withdrawn amount, verify it in the withdrawal tracker, then confirm receipt."
            : "The transaction reached finality without a successful execution result.",
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

/**
 * Confirm receipt of an emitted payout and clear the pending record.
 *
 * The caller (the WithdrawalTracker) enables this only after verifying,
 * from the recipients own wallet balance, that the asynchronous transfer
 * actually landed. On success the pending record is re-read and the local
 * tracker record is cleared.
 */
export function useConfirmWithdrawal() {
  const contract = useFactVerifierContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isConfirming, setIsConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!contract) {
        throw new Error("Contract not configured.");
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to confirm receipt."
        );
      }
      setIsConfirming(true);
      const feePreset = await contract.estimateConfirmWithdrawalFees();
      return contract.confirmWithdrawal(feePreset);
    },
    onSuccess: async (receipt: TransactionReceipt) => {
      if (isSuccessful(receipt) && address) {
        // Re-read the pending record: a successful confirm must have
        // cleared it. Only then drop the local tracker record.
        const stillPending = await contract!.getPendingWithdrawal(address);
        if (stillPending === 0n) {
          clearWithdrawalRecord(address);
        }
      }
      invalidateAll(queryClient);
      setIsConfirming(false);
      success(
        isSuccessful(receipt)
          ? "Receipt confirmed, pending record cleared"
          : "Confirmation recorded (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "The pending withdrawal record is cleared. The payout lifecycle is complete."
            : "The transaction reached finality without a successful execution result.",
        }
      );
    },
    onError: (err: any) => {
      console.error("Error confirming withdrawal:", err);
      setIsConfirming(false);
      error("Failed to confirm receipt", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isConfirming,
    confirmWithdrawal: mutation.mutate,
    confirmWithdrawalAsync: mutation.mutateAsync,
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
    onSuccess: (receipt: TransactionReceipt) => {
      invalidateAll(queryClient);
      setIsWithdrawing(false);
      success(
        isSuccessful(receipt)
          ? "Treasury withdrawn!"
          : "Treasury withdrawal recorded (outcome not confirmed)",
        {
          description: isSuccessful(receipt)
            ? "Protocol fees have been transferred to the owner."
            : "The transaction reached finality without a successful execution result.",
        }
      );
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
