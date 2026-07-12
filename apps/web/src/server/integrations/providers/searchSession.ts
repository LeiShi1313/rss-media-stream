import type { ProviderSource } from "@rss-media/shared/types";
import type {
  ProviderMetadataCandidate,
  ProviderRuntimeContext,
  ProviderSearchInput
} from "./types.js";

export type ProviderSearchOperation = (
  providerSource: ProviderSource,
  runtime: ProviderRuntimeContext,
  input: ProviderSearchInput
) => Promise<ProviderMetadataCandidate[]>;

export class ProviderSearchSession {
  readonly #requests = new Map<string, Promise<ProviderMetadataCandidate[]>>();

  constructor(private readonly operation: ProviderSearchOperation) {}

  search(
    providerSource: ProviderSource,
    runtime: ProviderRuntimeContext,
    input: ProviderSearchInput
  ): Promise<ProviderMetadataCandidate[]> {
    const key = JSON.stringify([
      providerSource,
      input.title,
      input.titleSource,
      input.mediaType,
      input.year,
      input.season,
      input.episode,
      input.language,
      input.region
    ]);
    const existing = this.#requests.get(key);
    if (existing) return existing;

    const request = this.operation(providerSource, runtime, input);
    this.#requests.set(key, request);
    return request;
  }
}
