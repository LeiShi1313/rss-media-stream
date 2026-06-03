import type { TmdbResult } from "./types.js";

export function scoreCandidate(
  query: string,
  candidate: string,
  expectedYear: number | undefined,
  actualYear: number | undefined,
  result: TmdbResult
): number {
  const q = normalize(query);
  const c = normalize(candidate);
  let score = q === c ? 0.72 : tokenOverlap(q, c) * 0.72;
  if (expectedYear && actualYear) {
    score += expectedYear === actualYear ? 0.2 : Math.abs(expectedYear - actualYear) <= 1 ? 0.08 : -0.15;
  }
  if ((result.vote_count ?? 0) > 10) score += 0.04;
  if ((result.popularity ?? 0) > 10) score += 0.04;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}
