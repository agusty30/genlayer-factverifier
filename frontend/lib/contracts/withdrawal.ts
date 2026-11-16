/**
 * Withdrawal lifecycle helpers.
 *
 * The payout primitive is asynchronous: `withdraw()` emits an EOA transfer
 * through the contracts ghost contract, and the value is credited to the
 * recipient only when the child transaction executes. The parent
 * transaction reaching finality proves only that the transfer was EMITTED,
 * never that the recipient RECEIVED it. A failed child does not return the
 * value automatically; the contract keeps the amount in `pending_withdrawals`
 * until the recipient confirms receipt with `confirm_withdrawal()`.
 *
 * The only proof that a payout landed is the recipients own wallet balance:
 * capture the balance BEFORE the withdraw, read it again afterwards, and
 * treat the payout as received only when the balance has grown by at least
 * the pending amount. Everything in this module is pure (or localStorage)
 * so the verification rule is unit-testable without a chain.
 */

export const WITHDRAWAL_RECLAIM_DELAY_SECONDS = 3600;

/**
 * How much the recipients balance has grown since the baseline captured
 * before the withdraw. Negative growth is clamped to zero: a balance that
 * fell (the user spent GEN elsewhere) is not evidence of a payout.
 */
export function payoutDelta(
  baseline: bigint | null | undefined,
  current: bigint | null | undefined
): bigint {
  if (baseline === null || baseline === undefined) return 0n;
  if (current === null || current === undefined) return 0n;
  const delta = current - baseline;
  return delta > 0n ? delta : 0n;
}

/**
 * True only when the recipients balance has grown by at least the pending
 * payout amount. This is the single rule that gates `confirm_withdrawal()`:
 * parent-transaction finality alone never counts as receipt.
 */
export function verifyPayoutReceived(
  baseline: bigint | null | undefined,
  current: bigint | null | undefined,
  pending: bigint | null | undefined
): boolean {
  if (pending === null || pending === undefined || pending <= 0n) return false;
  if (baseline === null || baseline === undefined) return false;
  if (current === null || current === undefined) return false;
  return payoutDelta(baseline, current) >= pending;
}

/**
 * A withdrawal the user started, persisted so the tracker survives a page
 * reload. The baseline balance is captured BEFORE `withdraw()` is sent, so
 * the later balance delta is meaningful.
 */
export interface WithdrawalRecord {
  address: string;
  /** Native GEN balance (wei) captured before the withdraw was sent. */
  baselineWei: string;
  /** Amount withdrawn (wei), as reported by the contract after the call. */
  amountWei: string;
  /** Hash of the parent withdraw() transaction. */
  txHash: string;
  /** Unix seconds when the withdraw was sent. */
  emittedAt: number;
}

function recordKey(address: string): string {
  return `factverifier.withdrawal.${address.toLowerCase()}`;
}

export function saveWithdrawalRecord(record: WithdrawalRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recordKey(record.address), JSON.stringify(record));
  } catch {
    // Storage full or unavailable: the tracker still works from the
    // on-chain pending amount, it just cannot verify by balance delta.
  }
}

export function loadWithdrawalRecord(
  address: string | null | undefined
): WithdrawalRecord | null {
  if (!address || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(recordKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WithdrawalRecord;
    if (!parsed || typeof parsed.baselineWei !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearWithdrawalRecord(
  address: string | null | undefined
): void {
  if (!address || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recordKey(address));
  } catch {
    // Ignore: a stale record is harmless, the tracker re-reads on-chain.
  }
}
