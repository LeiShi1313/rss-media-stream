export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs} ms`);
    this.name = "OperationTimeoutError";
  }
}

export async function runWithTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new OperationTimeoutError(timeoutMs);
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}
