import type { MediaType } from "@rss-media/shared/types";

export type ProviderCandidateScoreInput = {
  query: string;
  candidateTitles: readonly (string | null | undefined)[];
  mediaType: MediaType;
  expectedYear?: number;
  actualYear?: number;
  season?: number;
};

export function scoreProviderCandidate(input: ProviderCandidateScoreInput): number {
  const query = normalizeForScore(input.query);
  if (!query) return 0;

  const candidates = uniqueNormalizedTitles(input.candidateTitles);
  if (candidates.length === 0) return 0;

  const titleScore = Math.max(
    ...candidates.map((candidate) =>
      titleSimilarity(query, candidate, {
        mediaType: input.mediaType,
        season: input.season
      })
    )
  );

  let score = titleScore * 0.78;
  if (input.expectedYear && input.actualYear) {
    if (input.mediaType === "TV_SERIES" && input.expectedYear > input.actualYear) {
      return roundScore(score);
    }
    const yearDelta = Math.abs(input.expectedYear - input.actualYear);
    score += yearDelta === 0 ? 0.2 : yearDelta === 1 ? 0.08 : -0.15;
    if (yearDelta > 1) score = Math.min(score, 0.55);
    if (yearDelta === 0 && titleScore >= 0.94) score = Math.max(score, 0.93);
    if (yearDelta === 0 && titleScore >= 0.88) score = Math.max(score, 0.9);
    if (yearDelta === 0 && input.mediaType === "TV_SERIES" && input.season && titleScore >= 0.86) {
      score = Math.max(score, 0.88);
    }
  }

  return roundScore(score);
}

export function normalizeForScore(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['\u2018\u2019`]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleSimilarity(
  query: string,
  candidate: string,
  input: { mediaType: MediaType; season?: number }
) {
  if (query === candidate) return 1;

  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate);
  const queryScoreTokens = scoreTokens(queryTokens);
  const candidateScoreTokens = scoreTokens(candidateTokens);
  const containment = containmentSimilarity(queryTokens, candidateTokens, input);
  const token = tokenDice(queryScoreTokens, candidateScoreTokens);
  const character = ngramDice(queryScoreTokens.join(" "), candidateScoreTokens.join(" ")) * 0.96;
  return Math.max(containment, token, character);
}

function containmentSimilarity(
  queryTokens: string[],
  candidateTokens: string[],
  input: { mediaType: MediaType; season?: number }
) {
  const forward = containedTokenWindow(queryTokens, candidateTokens);
  if (forward) return containedWindowScore(forward.shorter, forward.extra, input);

  const reverse = containedTokenWindow(candidateTokens, queryTokens);
  if (reverse) return containedWindowScore(reverse.shorter, reverse.extra, input);

  return 0;
}

function containedWindowScore(
  shorter: string[],
  extra: string[],
  input: { mediaType: MediaType; season?: number }
) {
  if (extra.length === 0) return 1;
  if (input.mediaType === "TV_SERIES" && seasonExtraMatches(extra, input.season)) {
    return 0.94;
  }
  if (shorter.length >= 3 && extra.length <= 1) return 0.88;
  if (shorter.length >= 4 && extra.length <= 2) return 0.9;
  if (shorter.length >= 5 && extra.length <= 4) return 0.88;
  return 0.8;
}

function containedTokenWindow(shorter: string[], longer: string[]) {
  if (shorter.length === 0 || shorter.length > longer.length) return undefined;
  for (let start = 0; start <= longer.length - shorter.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < shorter.length; offset += 1) {
      if (shorter[offset] !== longer[start + offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    return {
      shorter,
      extra: [
        ...longer.slice(0, start),
        ...longer.slice(start + shorter.length)
      ]
    };
  }
  return undefined;
}

function seasonExtraMatches(extra: string[], season?: number) {
  if (!season) return false;
  const meaningful = extra.filter((token) => !["season", "series", "part", "cour"].includes(token));
  if (meaningful.length !== 1) return false;
  return seasonTokenValue(meaningful[0]) === season;
}

function seasonTokenValue(token: string) {
  const direct = token.match(/^(?:s)?(\d{1,2})$/)?.[1];
  if (direct) return Number(direct);
  return romanNumerals[token];
}

const romanNumerals: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12
};

function tokenDice(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let intersection = 0;
  for (const token of b) {
    const count = counts.get(token) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    counts.set(token, count - 1);
  }
  return (2 * intersection) / (a.length + b.length);
}

function ngramDice(a: string, b: string) {
  const aGrams = ngrams(a);
  const bGrams = ngrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) return 0;
  return tokenDice(aGrams, bGrams);
}

function ngrams(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 3) return [compact];
  const grams: string[] = [];
  for (let index = 0; index <= compact.length - 3; index += 1) {
    grams.push(compact.slice(index, index + 3));
  }
  return grams;
}

function uniqueNormalizedTitles(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const title = normalizeForScore(value);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    normalized.push(title);
  }
  return normalized;
}

function tokens(value: string) {
  return value ? value.split(" ") : [];
}

const HONORIFIC_TOKENS = new Set(["mr", "mrs", "ms", "miss", "dr"]);

function scoreTokens(value: string[]) {
  return value.filter((token) => !HONORIFIC_TOKENS.has(token));
}

function roundScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
