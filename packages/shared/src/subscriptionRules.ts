import type {
  CandidateInput,
  NormalizedSubscriptionRule,
  RuleDecision,
  SubscriptionRuleInput
} from "./types.js";

const MIN_MATCH_SCORE = 0.84;
const MAX_REGEX_LENGTH = 300;

const SOURCE_ALIASES: Record<string, string> = {
  WEB: "WEB",
  WEBDL: "WEB-DL",
  WEBRIP: "WEBRIP",
  BLURAY: "BLURAY",
  BDRIP: "BDRIP",
  HDTV: "HDTV",
  DVDRIP: "DVDRIP",
  REMUX: "REMUX",
  UHD: "UHD",
  HDRIP: "HDRIP"
};

export class SubscriptionRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionRuleValidationError";
  }
}

export function evaluateSubscriptionRule(
  rule: SubscriptionRuleInput,
  candidate: CandidateInput
): RuleDecision {
  const normalized = normalizeRule(rule);

  if (!candidate.match || ["REJECTED", "UNMATCHED"].includes(candidate.match.status)) {
    return reject("metadata has not been matched", normalized);
  }

  if (normalized.provider && normalizeProvider(candidate.match.provider) !== normalized.provider) {
    return reject("metadata provider does not match subscription", normalized);
  }

  if (normalized.providerId && candidate.match.providerId !== normalized.providerId) {
    return reject("metadata provider id does not match subscription", normalized);
  }

  if (normalized.imdbId && candidate.match.imdbId !== normalized.imdbId) {
    return reject("IMDb id does not match subscription", normalized);
  }

  if (normalized.doubanId && candidate.match.doubanId !== normalized.doubanId) {
    return reject("Douban id does not match subscription", normalized);
  }

  if (
    normalized.mediaKind &&
    normalized.mediaKind !== "UNKNOWN" &&
    candidate.release.kind !== normalized.mediaKind
  ) {
    return reject("media kind does not match", normalized);
  }

  if (candidate.match.score < MIN_MATCH_SCORE) {
    return reject("metadata match confidence is below auto-download threshold", normalized);
  }

  if (!matchesTitleRegex(normalized.titleRegex, candidate.release.title, candidate.rawTitle)) {
    return reject("title regex did not match", normalized);
  }

  if (!matchesRegex(normalized.includeRegex, candidate.rawTitle, true)) {
    return reject("include regex did not match", normalized);
  }

  if (matchesRegex(normalized.excludeRegex, candidate.rawTitle, false)) {
    return reject("exclude regex matched", normalized);
  }

  const resolution =
    normalized.minResolution !== undefined || normalized.maxResolution !== undefined
      ? releaseResolution(candidate)
      : undefined;
  if (normalized.minResolution !== undefined) {
    if (resolution === undefined) return reject("release resolution is missing", normalized);
    if (resolution < normalized.minResolution) {
      return reject("resolution is below subscription minimum", normalized);
    }
  }

  if (normalized.maxResolution !== undefined) {
    if (resolution === undefined) return reject("release resolution is missing", normalized);
    if (resolution > normalized.maxResolution) {
      return reject("resolution is above subscription maximum", normalized);
    }
  }

  if (!matchesStringDimension(normalized.sources, candidate.release.source, normalizeSource)) {
    return reject("source does not match subscription", normalized);
  }

  if (!matchesStringDimension(normalized.codecs, candidate.release.codec, normalizeCodec)) {
    return reject("codec does not match subscription", normalized);
  }

  if (!matchesStringDimension(normalized.audio, candidate.release.audio, normalizeAudio)) {
    return reject("audio does not match subscription", normalized);
  }

  const releaseGroup = normalizeReleaseGroup(candidate.release.releaseGroup);
  if (normalized.releaseGroupsInclude.length > 0) {
    if (!releaseGroup) return reject("release group is missing", normalized);
    if (!normalized.releaseGroupsInclude.includes(releaseGroup)) {
      return reject("release group is not included by subscription", normalized);
    }
  }

  if (releaseGroup && normalized.releaseGroupsExclude.includes(releaseGroup)) {
    return reject("release group is excluded by subscription", normalized);
  }

  const sizeBytes = normalizeOptionalBigInt(candidate.sizeBytes);
  if (normalized.minSizeBytes !== undefined) {
    if (sizeBytes === undefined) return reject("release size is missing", normalized);
    if (sizeBytes < normalized.minSizeBytes) {
      return reject("release size is below subscription minimum", normalized);
    }
  }

  if (normalized.maxSizeBytes !== undefined) {
    if (sizeBytes === undefined) return reject("release size is missing", normalized);
    if (sizeBytes > normalized.maxSizeBytes) {
      return reject("release size is above subscription maximum", normalized);
    }
  }

  if (requiresStrictEpisode(normalized, candidate)) {
    if (!hasNumber(candidate.release.season) || !hasNumber(candidate.release.episode)) {
      return reject("series release lacks strict season and episode fields", normalized);
    }
    if (hasNumber(normalized.season) && candidate.release.season !== normalized.season) {
      return reject("season does not match subscription", normalized);
    }
    if (
      hasNumber(normalized.episodeStart) &&
      candidate.release.episode < normalized.episodeStart
    ) {
      return reject("episode is before subscription range", normalized);
    }
    if (
      hasNumber(normalized.episodeEnd) &&
      candidate.release.episode > normalized.episodeEnd
    ) {
      return reject("episode is after subscription range", normalized);
    }
  }

  return { accepted: true, reason: "accepted", ruleSnapshot: serializeRuleSnapshot(normalized) };
}

export function normalizeRule(rule: SubscriptionRuleInput): NormalizedSubscriptionRule {
  const provider = normalizeProvider(optionalString(rule.provider));
  const minResolution = normalizeOptionalResolution(rule.minResolution);
  const maxResolution = normalizeOptionalResolution(rule.maxResolution);

  if (
    minResolution !== undefined &&
    maxResolution !== undefined &&
    minResolution > maxResolution
  ) {
    throw new SubscriptionRuleValidationError(
      "minResolution cannot be greater than maxResolution"
    );
  }

  const minSizeBytes = normalizeOptionalBigInt(rule.minSizeBytes);
  const maxSizeBytes = normalizeOptionalBigInt(rule.maxSizeBytes);

  if (
    minSizeBytes !== undefined &&
    maxSizeBytes !== undefined &&
    minSizeBytes > maxSizeBytes
  ) {
    throw new SubscriptionRuleValidationError(
      "minSizeBytes cannot be greater than maxSizeBytes"
    );
  }

  return {
    mediaKind: rule.mediaKind ?? undefined,
    provider,
    providerId: optionalString(rule.providerId),
    imdbId: optionalString(rule.imdbId),
    doubanId: optionalString(rule.doubanId),
    titleRegex: normalizeRegex(rule.titleRegex),
    includeRegex: normalizeRegex(rule.includeRegex),
    excludeRegex: normalizeRegex(rule.excludeRegex),
    minResolution,
    maxResolution,
    sources: normalizeStringList(rule.sources, normalizeSource),
    codecs: normalizeStringList(rule.codecs, normalizeCodec),
    audio: normalizeStringList(rule.audio, normalizeAudio),
    releaseGroupsInclude: normalizeStringList(
      rule.releaseGroupsInclude,
      normalizeReleaseGroup
    ),
    releaseGroupsExclude: normalizeStringList(
      rule.releaseGroupsExclude,
      normalizeReleaseGroup
    ),
    minSizeBytes,
    maxSizeBytes,
    season: normalizeOptionalInt(rule.season),
    episodeStart: normalizeOptionalInt(rule.episodeStart),
    episodeEnd: normalizeOptionalInt(rule.episodeEnd)
  };
}

export function serializeRuleSnapshot(
  rule: NormalizedSubscriptionRule
): Record<string, unknown> {
  return {
    ...rule,
    minSizeBytes: rule.minSizeBytes?.toString(),
    maxSizeBytes: rule.maxSizeBytes?.toString()
  };
}

export function normalizeResolution(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new SubscriptionRuleValidationError("resolution must be a positive integer");
    }
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new SubscriptionRuleValidationError("resolution cannot be empty");
  }
  if (normalized === "4k") return 2160;

  const match = normalized.match(/^(\d{3,4})p?$/);
  if (!match) {
    throw new SubscriptionRuleValidationError(`unsupported resolution: ${value}`);
  }
  return Number(match[1]);
}

export function normalizeSource(value: string | null | undefined): string | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;
  return SOURCE_ALIASES[normalized] ?? normalized;
}

export function normalizeCodec(value: string | null | undefined): string | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;
  if (["H265", "X265", "HEVC"].includes(normalized)) return "H.265";
  if (["H264", "X264", "AVC"].includes(normalized)) return "H.264";
  return normalized;
}

export function normalizeAudio(value: string | null | undefined): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  return raw.toUpperCase().replace(/\s+/g, "").replace(/-/g, ".");
}

export function normalizeReleaseGroup(value: string | null | undefined): string | undefined {
  const raw = optionalString(value);
  return raw?.toUpperCase();
}

function normalizeOptionalResolution(
  value: number | string | null | undefined
): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return normalizeResolution(value);
}

function normalizeOptionalBigInt(
  value: bigint | number | string | null | undefined
): bigint | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new SubscriptionRuleValidationError("size must be a non-negative integer");
    }
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) {
    throw new SubscriptionRuleValidationError("size must be a non-negative integer");
  }
  return BigInt(value);
}

function normalizeOptionalInt(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new SubscriptionRuleValidationError("episode and season values must be integers");
  }
  return value;
}

function normalizeRegex(value: string | null | undefined): string | undefined {
  const expression = optionalString(value);
  if (!expression) return undefined;
  if (expression.length > MAX_REGEX_LENGTH) {
    throw new SubscriptionRuleValidationError("regex is too long");
  }
  try {
    new RegExp(expression, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SubscriptionRuleValidationError(`invalid regex: ${message}`);
  }
  return expression;
}

function normalizeStringList(
  values: string[] | null | undefined,
  normalizer: (value: string) => string | undefined
): string[] {
  if (!values) return [];
  const normalized = values.map(normalizer).filter((value): value is string => Boolean(value));
  return [...new Set(normalized)];
}

function normalizeProvider(value: string | null | undefined): string | undefined {
  return optionalString(value)?.toLowerCase();
}

function normalizeToken(value: string | null | undefined): string | undefined {
  const raw = optionalString(value);
  return raw?.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function matchesRegex(
  expression: string | undefined,
  value: string,
  defaultWhenMissing: boolean
): boolean {
  if (!expression) return defaultWhenMissing;
  return new RegExp(expression, "i").test(value);
}

function matchesTitleRegex(
  expression: string | undefined,
  parsedTitle: string,
  rawTitle: string
): boolean {
  if (!expression) return true;
  const regex = new RegExp(expression, "i");
  return regex.test(parsedTitle) || regex.test(normalizeTitle(parsedTitle)) || regex.test(rawTitle);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function releaseResolution(candidate: CandidateInput): number | undefined {
  return (
    candidate.release.resolution ??
    normalizeOptionalResolution(candidate.release.quality) ??
    resolutionFromText(candidate.rawTitle)
  );
}

function resolutionFromText(value: string): number | undefined {
  const match = value.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  return match ? normalizeResolution(match[1]) : undefined;
}

function matchesStringDimension(
  ruleValues: string[],
  candidateValue: string | undefined,
  normalizer: (value: string | undefined) => string | undefined
): boolean {
  if (ruleValues.length === 0) return true;
  const normalized = normalizer(candidateValue);
  return normalized ? ruleValues.includes(normalized) : false;
}

function requiresStrictEpisode(
  rule: NormalizedSubscriptionRule,
  candidate: CandidateInput
): boolean {
  return (
    rule.mediaKind === "TV" ||
    candidate.release.kind === "TV" ||
    hasNumber(rule.season) ||
    hasNumber(rule.episodeStart) ||
    hasNumber(rule.episodeEnd)
  );
}

function hasNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function reject(reason: string, rule: NormalizedSubscriptionRule): RuleDecision {
  return { accepted: false, reason, ruleSnapshot: serializeRuleSnapshot(rule) };
}
