import type { ParsedRelease } from "./types.js";

export function buildReleaseSignature(
  release: Pick<
    ParsedRelease,
    | "title"
    | "mediaType"
    | "year"
    | "season"
    | "episode"
    | "episodeEnd"
    | "quality"
    | "source"
    | "codec"
    | "audio"
    | "releaseGroup"
  >,
  sizeBytes?: bigint
): string | undefined {
  if (!release.title) return undefined;

  return [
    ["title", release.title],
    ["mediaType", release.mediaType],
    ["year", release.year],
    ["season", release.season],
    ["episode", release.episode],
    ["episodeEnd", release.episodeEnd],
    ["quality", release.quality],
    ["source", release.source],
    ["codec", release.codec],
    ["audio", release.audio],
    ["group", release.releaseGroup],
    ["size", sizeBytes?.toString()]
  ]
    .map(([key, value]) => `${key}=${normalizeSignaturePart(value)}`)
    .join("|");
}

function normalizeSignaturePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
