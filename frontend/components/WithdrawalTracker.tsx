"use client";

import { formatEther } from "viem";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  useConfirmWithdrawal,
  useNativeBalance,
  usePendingWithdrawal,
} from "@/lib/hooks/useFactVerifier";
import {
  loadWithdrawalRecord,
  payoutDelta,
  verifyPayoutReceived,
  WITHDRAWAL_RECLAIM_DELAY_SECONDS,
  type WithdrawalRecord,
} from "@/lib/contracts/withdrawal";
import { Button } from "./ui/button";

function gen(wei: bigint | null | undefined): string {
  if (wei === null || wei === undefined) return "0";
  return Number(formatEther(wei)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

/**
 * Tracked withdrawal lifecycle.
 *
 * After `withdraw()` the payout is only EMITTED, not received: the EOA
 * transfer is asynchronous, and the parent transaction reaching finality
 * proves nothing about the recipient actually getting the funds. This
 * tracker therefore verifies receipt from the recipients own wallet
 * balance (baseline captured before the withdraw vs. the live balance) and
 * only then offers `confirmWithdrawal()`, which clears the contracts
 * pending-withdrawal record. The confirm button stays disabled until the
 * balance has grown by at least the pending amount.
 *
 * If the baseline was never captured (for example the page was reloaded
 * before the record was saved), the user must explicitly confirm they
 * checked their balance on the explorer before confirming.
 */
export function WithdrawalTracker() {
  const { address, isConnected } = useWallet();
  const { data: pending = 0n } = usePendingWithdrawal(address);
  const { data: balance = 0n } = useNativeBalance(
    address,
    pending > 0n
  );
  const { confirmWithdrawal, isConfirming } = useConfirmWithdrawal();
  const [record, setRecord] = useState<WithdrawalRecord | null>(null);
  const [manualVerified, setManualVerified] = useState(false);

  useEffect(() => {
    setRecord(loadWithdrawalRecord(address));
    setManualVerified(false);
  }, [address, pending]);

  if (!isConnected || !address) return null;
  // Nothing to track: no pending payout and no recorded withdrawal.
  if (pending === 0n && !record) return null;

  const baseline =
    record && record.baselineWei ? BigInt(record.baselineWei) : null;
  const delta = payoutDelta(baseline, balance);
  const verified = verifyPayoutReceived(baseline, balance, pending);
  const canConfirm = pending > 0n && (verified || manualVerified);
  const emittedAt = record ? record.emittedAt : null;
  const recreditOpen =
    emittedAt !== null &&
    Math.floor(Date.now() / 1000) - emittedAt >=
      WITHDRAWAL_RECLAIM_DELAY_SECONDS;

  return (
    <div className="brand-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-accent" />
        <p className="text-sm font-semibold">Withdrawal tracker</p>
        <span className="text-xs text-muted-foreground">
          {pending > 0n ? "payout pending" : "no pending payout"}
        </span>
      </div>

      <ol className="flex flex-col gap-2 text-sm">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          <div>
            <p className="font-medium">1. Withdrawal emitted</p>
            <p className="text-xs text-muted-foreground">
              The withdraw transaction finalized. Finality proves only that
              the transfer was emitted, not that it was received.
            </p>
          </div>
        </li>

        <li className="flex items-start gap-2">
          {verified ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          ) : (
            <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          )}
          <div>
            <p className="font-medium">2. Verify the payout landed</p>
            <p className="text-xs text-muted-foreground">
              Pending payout: {gen(pending)} GEN. Wallet balance before the
              withdraw: {baseline !== null ? `${gen(baseline)} GEN` : "not captured"}.
              Current balance: {gen(balance)} GEN. Balance growth since the
              withdraw: {gen(delta)} GEN.
            </p>
            {pending > 0n && !verified && baseline !== null && (
              <p className="text-xs text-muted-foreground mt-1">
                Waiting for the balance to grow by at least {gen(pending)}{" "}
                GEN. The asynchronous transfer can take a while; this
                tracker re-checks every 5 seconds.
              </p>
            )}
            {pending > 0n && !verified && baseline === null && (
              <label className="flex items-start gap-2 mt-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualVerified}
                  onChange={(e) => setManualVerified(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I checked my wallet balance on the explorer and confirm
                  it grew by at least {gen(pending)} GEN since the withdraw.
                </span>
              </label>
            )}
            {pending > 0n && !verified && recreditOpen && (
              <p className="text-xs text-muted-foreground mt-1">
                The balance still has not grown and more than one hour has
                passed since the payout was emitted. The transfer may have
                failed asynchronously; the contract owner can recredit the
                pending amount after verifying the failure on the explorer.
              </p>
            )}
          </div>
        </li>

        <li className="flex items-start gap-2">
          {pending === 0n ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          ) : (
            <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1">
            <p className="font-medium">3. Confirm receipt</p>
            <p className="text-xs text-muted-foreground">
              Calling confirmWithdrawal clears the pending-withdrawal record
              on-chain. It is enabled only after receipt is verified above.
            </p>
            {pending > 0n && (
              <Button
                variant="gradient"
                size="sm"
                className="mt-2"
                disabled={!canConfirm || isConfirming}
                onClick={() => confirmWithdrawal()}
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Confirming…
                  </>
                ) : (
                  "Confirm receipt"
                )}
              </Button>
            )}
            {pending === 0n && (
              <p className="text-xs text-accent mt-1">
                Pending record cleared. The payout lifecycle is complete.
              </p>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
