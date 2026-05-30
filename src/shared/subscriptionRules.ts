import type {
  CandidateInput,
  RuleDecision,
  SubscriptionRuleInput
} from "./types.js";

const QUALITY_RANK: Record<string, number> = {
  "480p": 1,
  "720p": 2,
  "1080p": 3,
  "2160p": 4,
  "4k": 4
};

export function evaluateSubscriptionRule(
  rule: SubscriptionRuleInput,
  candidate: CandidateInput
): RuleDecision {
  if (!candidate.match || candidate.match.status === "REJECTED") {
    return reject("metadata has not been matched");
  }
  if (
    candidate.match.provider !== rule.mediaProvider ||
    candidate.match.providerId !== rule.mediaProviderId
  ) {
    return reject("metadata provider id does not match subscription");
  }
  if (rule.mediaKind !== "UNKNOWN" && candidate.release.kind !== rule.mediaKind) {
    return reject("media kind does not match");
  }
  if (candidate.match.score < 0.84) {
    return reject("metadata match confidence is below auto-download threshold");
  }
  if (!matchesRegex(rule.includeRegex, candidate.rawTitle, true)) {
    return reject("include regex did not match");
  }
  if (matchesRegex(rule.excludeRegex, candidate.rawTitle, false)) {
    return reject("exclude regex matched");
  }
  if (!passesQuality(rule.minQuality, candidate.release.quality)) {
    return reject("quality is below subscription minimum");
  }
  if (rule.mediaKind === "TV") {
    if (!candidate.release.season || !candidate.release.episode) {
      return reject("series release lacks strict season and episode fields");
    }
    if (rule.season && candidate.release.season !== rule.season) {
      return reject("season does not match subscription");
    }
    if (
      rule.episodeStart &&
      candidate.release.episode < rule.episodeStart
    ) {
      return reject("episode is before subscription range");
    }
    if (rule.episodeEnd && candidate.release.episode > rule.episodeEnd) {
      return reject("episode is after subscription range");
    }
  }
  return { accepted: true, reason: "accepted" };
}

function matchesRegex(
  expression: string | null | undefined,
  value: string,
  defaultWhenMissing: boolean
): boolean {
  if (!expression) return defaultWhenMissing;
  try {
    return new RegExp(expression, "i").test(value);
  } catch {
    return false;
  }
}

function passesQuality(
  minimum: string | null | undefined,
  actual: string | null | undefined
): boolean {
  if (!minimum) return true;
  if (!actual) return false;
  return qualityRank(actual) >= qualityRank(minimum);
}

function qualityRank(value: string): number {
  return QUALITY_RANK[value.toLowerCase()] ?? 0;
}

function reject(reason: string): RuleDecision {
  return { accepted: false, reason };
}
