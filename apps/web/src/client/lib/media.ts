export type MediaKind = "MOVIE" | "TV";
export type MediaRuleType = "MOVIE" | "TV_SERIES";

export function kindFromMediaType(mediaType?: string): MediaKind | undefined {
  if (mediaType === "TV_SERIES") return "TV";
  if (mediaType === "MOVIE") return "MOVIE";
  return undefined;
}

// Unlike kindFromMediaType, passes "UNKNOWN" through for display fallbacks.
export function legacyKindFromMediaType(mediaType?: "MOVIE" | "TV_SERIES" | "UNKNOWN") {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}

export function mediaTypeFromKind(kind: MediaKind): MediaRuleType;
export function mediaTypeFromKind(kind?: string): MediaRuleType | undefined;
export function mediaTypeFromKind(kind?: string): MediaRuleType | undefined {
  if (kind === "TV") return "TV_SERIES";
  if (kind === "MOVIE") return "MOVIE";
  return undefined;
}
