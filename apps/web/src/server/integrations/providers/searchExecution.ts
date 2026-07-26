import { OperationTimeoutError, runWithTimeout } from "@rss-media/shared/async";
import { redactSecrets } from "@rss-media/shared/redact";
import type { MediaType, ProviderSource } from "@rss-media/shared/types";
import type { FastifyBaseLogger } from "fastify";

export const PROVIDER_SEARCH_TIMEOUT_MS = 5_000;
export const PROVIDER_SEARCH_RESULT_LIMIT = 8;

export type ProviderSearchLogger = Pick<FastifyBaseLogger, "info" | "warn">;

export async function executeProviderSearch<T>(
  input: {
    providerSource: ProviderSource;
    mediaType: MediaType;
    logger?: ProviderSearchLogger;
  },
  operation: (signal: AbortSignal) => Promise<T[]>
): Promise<T[]> {
  const startedAt = performance.now();

  try {
    const results = await runWithTimeout(PROVIDER_SEARCH_TIMEOUT_MS, operation);
    input.logger?.info({
      event: "provider_search_finished",
      providerSource: input.providerSource,
      mediaType: input.mediaType,
      outcome: "success",
      durationMs: Math.round(performance.now() - startedAt),
      resultCount: results.length
    }, "provider search finished");
    return results;
  } catch (error) {
    input.logger?.warn({
      event: "provider_search_finished",
      providerSource: input.providerSource,
      mediaType: input.mediaType,
      outcome: error instanceof OperationTimeoutError ? "timeout" : "error",
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: error instanceof OperationTimeoutError
        ? error.code
        : error instanceof Error
          ? error.name
          : "UNKNOWN_ERROR",
      errorMessage: redactSecrets(error instanceof Error ? error.message : String(error))
    }, "provider search finished");
    throw error;
  }
}
