import { describe, expect, it } from "vitest";
import {
  payoutDelta,
  verifyPayoutReceived,
  WITHDRAWAL_RECLAIM_DELAY_SECONDS,
} from "./withdrawal";

const ONE_GEN = 10n ** 18n;

describe("payoutDelta", () => {
  it("measures balance growth since the baseline", () => {
    expect(payoutDelta(100n * ONE_GEN, 100n * ONE_GEN + 5n * ONE_GEN)).toBe(
      5n * ONE_GEN
    );
  });

  it("returns zero when the balance did not grow", () => {
    expect(payoutDelta(100n * ONE_GEN, 100n * ONE_GEN)).toBe(0n);
  });

  it("clamps a balance drop to zero instead of a negative delta", () => {
    expect(payoutDelta(100n * ONE_GEN, 90n * ONE_GEN)).toBe(0n);
  });

  it("returns zero when either reading is missing", () => {
    expect(payoutDelta(null, 100n * ONE_GEN)).toBe(0n);
    expect(payoutDelta(100n * ONE_GEN, null)).toBe(0n);
    expect(payoutDelta(undefined, undefined)).toBe(0n);
  });
});

describe("verifyPayoutReceived", () => {
  it("is true when the balance grew by at least the pending amount", () => {
    expect(
      verifyPayoutReceived(
        100n * ONE_GEN,
        100n * ONE_GEN + 2n * ONE_GEN,
        2n * ONE_GEN
      )
    ).toBe(true);
  });

  it("is true when the balance grew by more than the pending amount", () => {
    expect(
      verifyPayoutReceived(
        100n * ONE_GEN,
        100n * ONE_GEN + 5n * ONE_GEN,
        2n * ONE_GEN
      )
    ).toBe(true);
  });

  it("is false when the balance grew by less than the pending amount", () => {
    expect(
      verifyPayoutReceived(
        100n * ONE_GEN,
        100n * ONE_GEN + 1n * ONE_GEN,
        2n * ONE_GEN
      )
    ).toBe(false);
  });

  it("is false when the balance did not grow at all", () => {
    expect(
      verifyPayoutReceived(100n * ONE_GEN, 100n * ONE_GEN, 2n * ONE_GEN)
    ).toBe(false);
  });

  it("is false when there is no pending payout to verify", () => {
    expect(
      verifyPayoutReceived(100n * ONE_GEN, 102n * ONE_GEN, 0n)
    ).toBe(false);
    expect(
      verifyPayoutReceived(100n * ONE_GEN, 102n * ONE_GEN, null)
    ).toBe(false);
  });

  it("is false when the baseline was never captured", () => {
    expect(verifyPayoutReceived(null, 102n * ONE_GEN, 2n * ONE_GEN)).toBe(
      false
    );
  });

  it("is false when the current balance is unknown", () => {
    expect(
      verifyPayoutReceived(100n * ONE_GEN, null, 2n * ONE_GEN)
    ).toBe(false);
  });
});

describe("withdrawal constants", () => {
  it("matches the contracts recredit delay of one hour", () => {
    expect(WITHDRAWAL_RECLAIM_DELAY_SECONDS).toBe(3600);
  });
});
