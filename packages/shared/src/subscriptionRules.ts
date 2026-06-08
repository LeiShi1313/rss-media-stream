import type {
  CandidateInput,
  NormalizedSubscriptionRule,
  ProviderIdentityFilter,
  ProviderRatingFilter,
  ProviderTitleRuleView,
  RuleDecision,
  SubscriptionRuleInput
} from "./types.js";

const MAX_REGEX_LENGTH = 300;
const AUTO_DOWNLOAD_CONFIDENCE_THRESHOLD = 0.88;
const RATING_COMPARISONS = new Set(["gte", "lte", "gt", "lt", "eq"]);
const RATING_TYPES = new Set(["user_score", "critic_score", "popularity"]);

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

  if (!candidate.activeMatch || candidate.activeMatch.status !== "MATCHED") {
    return reject("release has no active matched media title", normalized);
  }

  if (
    candidate.activeMatch.source === "AUTO" &&
    candidate.activeMatch.confidence < AUTO_DOWNLOAD_CONFIDENCE_THRESHOLD
  ) {
    return reject("metadata match confidence is below auto-download threshold", normalized);
  }

  if (
    normalized.mediaType &&
    normalized.mediaType !== "UNKNOWN" &&
    candidate.activeMatch.mediaTitle.mediaType !== normalized.mediaType
  ) {
    return reject("media type does not match", normalized);
  }

  if (
    normalized.mediaTitleId &&
    candidate.activeMatch.mediaTitle.id !== normalized.mediaTitleId
  ) {
    return reject("media title does not match subscription", normalized);
  }

  if (
    normalized.selectedProvider &&
    !sameProviderIdentity(
      candidate.activeMatch.selectedProviderTitle,
      normalized.selectedProvider
    )
  ) {
    return reject("selected provider title does not match subscription", normalized);
  }

  for (const filter of normalized.linkedProviders) {
    if (
      !candidate.activeMatch.linkedProviderTitles.some((title) =>
        sameProviderIdentity(title, filter)
      )
    ) {
      return reject("linked provider title does not match subscription", normalized);
    }
  }

  for (const filter of normalized.providerRatings) {
    const ratingDecision = evaluateProviderRatingFilter(candidate, filter, normalized);
    if (ratingDecision) return ratingDecision;
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
  const criteria = criteriaObject(rule.criteriaJson);
  const mediaTitleId = optionalString(rule.mediaTitleId) ??
    optionalString(criteria.mediaTitleId);
  const selectedProvider = normalizeProviderIdentity(
    rule.selectedProvider ?? criteria.selectedProvider
  );
  const linkedProviders = normalizeProviderIdentityList(
    rule.linkedProviders ?? criteria.linkedProviders
  );
  const providerRatings = normalizeProviderRatingList(
    rule.providerRatings ?? criteria.providerRatings
  );
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
    mediaType: rule.mediaType ?? undefined,
    mediaTitleId,
    selectedProvider,
    linkedProviders,
    providerRatings,
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
    rule.mediaType === "TV_SERIES" ||
    candidate.release.mediaType === "TV_SERIES" ||
    hasNumber(rule.season) ||
    hasNumber(rule.episodeStart) ||
    hasNumber(rule.episodeEnd)
  );
}

function hasNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function criteriaObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeProviderIdentity(value: unknown): ProviderIdentityFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const provider = normalizeProvider(optionalUnknownString(input.provider));
  const providerId = optionalUnknownString(input.providerId);
  const providerEntityType = optionalUnknownString(input.providerEntityType);
  if (!provider && !providerId && !providerEntityType) return undefined;
  if (!provider || !providerId) {
    throw new SubscriptionRuleValidationError(
      "provider identity filters require provider and providerId"
    );
  }
  return {
    provider,
    providerId,
    ...(providerEntityType ? { providerEntityType } : {})
  };
}

function normalizeProviderIdentityList(value: unknown): ProviderIdentityFilter[] {
  if (!value) return [];
  if (!Array.isArray(value)) {
    throw new SubscriptionRuleValidationError("linkedProviders must be an array");
  }
  const normalized = value
    .map(normalizeProviderIdentity)
    .filter((filter): filter is ProviderIdentityFilter => Boolean(filter));
  return uniqueProviderIdentities(normalized);
}

function normalizeProviderRatingList(value: unknown): ProviderRatingFilter[] {
  if (!value) return [];
  if (!Array.isArray(value)) {
    throw new SubscriptionRuleValidationError("providerRatings must be an array");
  }
  return value
    .map(normalizeProviderRating)
    .filter((filter): filter is ProviderRatingFilter => Boolean(filter));
}

function normalizeProviderRating(value: unknown): ProviderRatingFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const provider = normalizeProvider(optionalUnknownString(input.provider));
  const comparison = optionalUnknownString(input.comparison);
  const ratingType = optionalUnknownString(input.ratingType);
  const ratingValue = optionalNumber(input.value);
  const scale = optionalNumber(input.scale);
  const minVoteCount = optionalInt(input.minVoteCount);

  if (
    !provider &&
    !comparison &&
    ratingValue === undefined &&
    scale === undefined &&
    minVoteCount === undefined &&
    !ratingType
  ) {
    return undefined;
  }
  if (!provider) {
    throw new SubscriptionRuleValidationError("provider rating filters require provider");
  }
  if (!comparison || !RATING_COMPARISONS.has(comparison)) {
    throw new SubscriptionRuleValidationError("provider rating comparison is unsupported");
  }
  if (ratingValue === undefined) {
    throw new SubscriptionRuleValidationError("provider rating value is required");
  }
  if (scale !== undefined && scale <= 0) {
    throw new SubscriptionRuleValidationError("provider rating scale must be positive");
  }
  if (minVoteCount !== undefined && minVoteCount < 0) {
    throw new SubscriptionRuleValidationError("provider rating min vote count must be non-negative");
  }
  if (ratingType && !RATING_TYPES.has(ratingType)) {
    throw new SubscriptionRuleValidationError("provider rating type is unsupported");
  }

  return {
    provider,
    comparison: comparison as ProviderRatingFilter["comparison"],
    value: ratingValue,
    ...(ratingType ? { ratingType: ratingType as ProviderRatingFilter["ratingType"] } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(minVoteCount !== undefined ? { minVoteCount } : {})
  };
}

function uniqueProviderIdentities(filters: ProviderIdentityFilter[]): ProviderIdentityFilter[] {
  const seen = new Set<string>();
  const result: ProviderIdentityFilter[] = [];
  for (const filter of filters) {
    const key = `${filter.provider}:${filter.providerEntityType ?? ""}:${filter.providerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(filter);
  }
  return result;
}

function sameProviderIdentity(
  title: ProviderTitleRuleView,
  filter: ProviderIdentityFilter
): boolean {
  return (
    normalizeProvider(title.provider) === filter.provider &&
    title.providerId === filter.providerId &&
    (!filter.providerEntityType || title.providerEntityType === filter.providerEntityType)
  );
}

function evaluateProviderRatingFilter(
  candidate: CandidateInput,
  filter: ProviderRatingFilter,
  normalized: NormalizedSubscriptionRule
): RuleDecision | undefined {
  const providerTitle = activeProviderTitles(candidate).find(
    (title) =>
      normalizeProvider(title.provider) === filter.provider &&
      (!filter.ratingType || title.ratingType === filter.ratingType)
  );

  if (!providerTitle || providerTitle.ratingValue == null || providerTitle.ratingScale == null) {
    return reject("provider rating is missing", normalized);
  }
  if (providerTitle.ratingScale <= 0) {
    return reject("provider rating scale is invalid", normalized);
  }
  if (
    filter.minVoteCount != null &&
    (providerTitle.ratingVoteCount == null || providerTitle.ratingVoteCount < filter.minVoteCount)
  ) {
    return reject("provider rating vote count is below subscription minimum", normalized);
  }

  const candidateScore = providerTitle.ratingValue / providerTitle.ratingScale;
  const threshold = filter.scale ? filter.value / filter.scale : filter.value;
  if (!compareRating(candidateScore, threshold, filter.comparison)) {
    return reject("provider rating does not match subscription", normalized);
  }
  return undefined;
}

function activeProviderTitles(candidate: CandidateInput): ProviderTitleRuleView[] {
  const match = candidate.activeMatch;
  if (!match) return [];
  const titles = [match.selectedProviderTitle, ...match.linkedProviderTitles];
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = `${title.providerTitleId}:${title.provider}:${title.providerEntityType}:${title.providerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareRating(left: number, right: number, comparison: ProviderRatingFilter["comparison"]) {
  switch (comparison) {
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "lt":
      return left < right;
    case "eq":
      return Math.abs(left - right) < Number.EPSILON;
  }
}

function optionalUnknownString(value: unknown): string | undefined {
  return typeof value === "string" ? optionalString(value) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    throw new SubscriptionRuleValidationError("provider rating numeric fields must be finite");
  }
  return numeric;
}

function optionalInt(value: unknown): number | undefined {
  const numeric = optionalNumber(value);
  if (numeric === undefined) return undefined;
  if (!Number.isInteger(numeric)) {
    throw new SubscriptionRuleValidationError("provider rating min vote count must be an integer");
  }
  return numeric;
}

function reject(reason: string, rule: NormalizedSubscriptionRule): RuleDecision {
  return { accepted: false, reason, ruleSnapshot: serializeRuleSnapshot(rule) };
}
