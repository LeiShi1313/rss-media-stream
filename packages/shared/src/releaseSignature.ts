import type { ParsedRelease } from "./types.js";

export function buildReleaseSignature(
  release: Pick<
    ParsedRelease,
    | "title"
    | "mediaType"
    | "year"
    | "tvUnitType"
    | "season"
    | "episode"
    | "episodeEnd"
    | "specialNumber"
    | "episodePart"
    | "quality"
    | "source"
    | "codec"
    | "audio"
    | "releaseGroup"
    | "variant"
  >,
  sizeBytes?: bigint
): string | undefined {
  if (!release.title) return undefined;

  const fields: Array<[string, unknown]> = [
    ["title", release.title],
    ["mediaType", release.mediaType],
    ["year", release.year],
    ["season", release.season],
    ["episode", release.episode],
    ["episodeEnd", release.episodeEnd]
  ];
  if (release.tvUnitType === "SPECIAL") {
    fields.push(["tvUnitType", release.tvUnitType]);
    fields.push(["specialNumber", release.specialNumber]);
  }
  if (release.episodePart) fields.push(["episodePart", release.episodePart]);
  if (release.variant) fields.push(["variant", release.variant]);
  fields.push(
    ["quality", release.quality],
    ["source", release.source],
    ["codec", release.codec],
    ["audio", release.audio],
    ["group", release.releaseGroup],
    ["size", sizeBytes?.toString()]
  );

  return fields.map(([key, value]) => `${key}=${normalizeSignaturePart(value)}`).join("|");
}

function normalizeSignaturePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
