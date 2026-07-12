import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationTimeoutError, runWithTimeout } from "../src/async.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runWithTimeout", () => {
  it("returns the operation result and clears the timeout", async () => {
    vi.useFakeTimers();

    await expect(runWithTimeout(5_000, async () => "done")).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the operation and rejects with a typed timeout error", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const result = runWithTimeout(5_000, async (signal) => {
      operationSignal = signal;
      return new Promise<never>(() => undefined);
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual(new OperationTimeoutError(5_000));
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toEqual(new OperationTimeoutError(5_000));
  });

  it("preserves operation failures and clears the timeout", async () => {
    vi.useFakeTimers();
    const failure = new Error("provider failed");

    await expect(runWithTimeout(5_000, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
