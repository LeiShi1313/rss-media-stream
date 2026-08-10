import type { MediaType } from "@rss-media/shared/types";

export const MIN_AUTO_MATCH_CONFIDENCE = 0.3;
export const LOW_CONFIDENCE_THRESHOLD = 0.88;

export type MatchingSearchTitle = {
  title: string;
  titleSource: "parsed_title" | "provider_search_title";
};

export function matchingSearchTitles(title: string, titleCandidates: string[] | undefined) {
  const titles: MatchingSearchTitle[] = [];
  const candidates: MatchingSearchTitle[] = [
    { title, titleSource: "parsed_title" },
    ...(titleCandidates ?? []).map((candidate) => ({
      title: candidate,
      titleSource: "provider_search_title" as const
    }))
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.title.trim();
    if (!trimmed) continue;
    if (!titles.some((existing) => existing.title.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      titles.push({ ...candidate, title: trimmed });
    }
    if (titles.length >= 5) break;
  }
  return titles;
}

export function releaseYearIncompatible(
  mediaType: MediaType,
  expectedYear?: number,
  actualYear?: number
) {
  if (expectedYear == null || actualYear == null) return false;
  if (mediaType === "TV_SERIES") {
    return expectedYear < actualYear;
  }
  return expectedYear !== actualYear;
}
