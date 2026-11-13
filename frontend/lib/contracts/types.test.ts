import { describe, expect, it } from "vitest";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { describeOutcome, isFinalized, isSuccessful } from "./types";

function receipt(overrides: Record<string, unknown>) {
  return {
    status: TransactionStatus.FINALIZED,
    statusName: TransactionStatus.FINALIZED,
    ...overrides,
  } as any;
}

describe("isSuccessful", () => {
  it("requires finality, not just a successful execution result", () => {
    expect(
      isSuccessful(
        receipt({
          status: TransactionStatus.ACCEPTED,
          statusName: TransactionStatus.ACCEPTED,
          txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
        })
      )
    ).toBe(false);
  });

  it("accepts a finalized transaction that finished with a return", () => {
    expect(
      isSuccessful(
        receipt({
          txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
        })
      )
    ).toBe(true);
  });

  it("rejects a finalized transaction that finished with an error", () => {
    expect(
      isSuccessful(
        receipt({
          txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR,
        })
      )
    ).toBe(false);
  });

  it("falls back to the numeric execution result for older receipts", () => {
    expect(isSuccessful(receipt({ txExecutionResult: 1 }))).toBe(true);
    expect(isSuccessful(receipt({ txExecutionResult: 2 }))).toBe(false);
  });

  it("rejects a missing receipt", () => {
    expect(isSuccessful(undefined as any)).toBe(false);
  });
});

describe("isFinalized", () => {
  it("recognizes the string status name", () => {
    expect(
      isFinalized(receipt({ status: undefined, statusName: TransactionStatus.FINALIZED }))
    ).toBe(true);
  });

  it("recognizes the numeric status value", () => {
    expect(
      isFinalized(receipt({ status: TransactionStatus.FINALIZED, statusName: undefined }))
    ).toBe(true);
  });
});

describe("describeOutcome", () => {
  it("distinguishes success from a finalized execution failure", () => {
    expect(
      describeOutcome(
        receipt({ txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN })
      )
    ).toContain("executed successfully");
    expect(
      describeOutcome(
        receipt({ txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR })
      )
    ).toContain("execution failed");
  });
});
