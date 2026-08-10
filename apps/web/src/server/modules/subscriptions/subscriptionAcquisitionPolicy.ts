import {
  normalizeReleaseGroup,
  normalizeReleaseVariant,
  normalizeResolution,
  normalizeSource
} from "@rss-media/shared/subscriptionRules";
import type {
  CandidateInput,
  NormalizedSubscriptionRule
} from "@rss-media/shared/types";

export type AcquisitionUnit = {
  contentKey: string;
  mediaTitleId: string;
  unitType: "MOVIE" | "TV_SEASON" | "TV_EPISODE" | "TV_SPECIAL";
  season?: number;
  episode?: number;
  episodeEnd?: number;
  specialNumber?: number;
  episodePart?: string;
  variant?: string;
};

export type ReleaseScore = {
  resolution: number | null;
  source: string | null;
  sourceRank: number;
  releaseGroup: string | null;
  preferredReleaseGroup: boolean;
};

export type AcquisitionState = {
  crossSeedFeedIds: readonly string[];
  currentResolution: number | null;
  currentSourceRank: number | null;
  currentReleaseGroup: string | null;
};

export type AcquisitionPreparation =
  | { accepted: false; reason: string }
  | { accepted: true; action: "DIRECT" }
  | {
      accepted: true;
      action: "CHECK";
      unit: AcquisitionUnit;
      score: ReleaseScore;
    };

export type AcquisitionDecision =
  | { accepted: false; reason: string }
  | { accepted: true; action: "DIRECT" }
  | {
      accepted: true;
      action: "SATISFY";
      unit: AcquisitionUnit;
      score: ReleaseScore;
    }
  | {
      accepted: true;
      action: "UPGRADE";
      unit: AcquisitionUnit;
      score: ReleaseScore;
      state: AcquisitionState;
      reason: string;
    }
  | {
      accepted: true;
      action: "CROSS_SEED";
      unit: AcquisitionUnit;
      score: ReleaseScore;
      state: AcquisitionState;
      forceDuplicate: true;
      reason: string;
    };

const SOURCE_RANKS: Record<string, number> = {
  REMUX: 60,
  UHD: 55,
  BLURAY: 50,
  "WEB-DL": 40,
  WEB: 35,
  WEBRIP: 30,
  HDTV: 20,
  DVDRIP: 10
};

export function prepareAcquisition(input: {
  rule: NormalizedSubscriptionRule;
  candidate: CandidateInput;
}): AcquisitionPreparation {
  if (input.rule.mode !== "MEDIA_TITLE") {
    return { accepted: true, action: "DIRECT" };
  }

  const unit = acquisitionUnitFromCandidate(input.candidate, input.rule);
  if (!unit) {
    return {
      accepted: false,
      reason: "release cannot be mapped to a media unit"
    };
  }

  return {
    accepted: true,
    action: "CHECK",
    unit,
    score: scoreRelease(input.candidate, input.rule)
  };
}

export function decideAcquisition(input: {
  preparation: AcquisitionPreparation;
  rule: NormalizedSubscriptionRule;
  feedId?: string | null;
  state: AcquisitionState | null;
}): AcquisitionDecision {
  if (!input.preparation.accepted || input.preparation.action === "DIRECT") {
    return input.preparation;
  }

  const { unit, score } = input.preparation;
  if (!input.state) {
    return { accepted: true, action: "SATISFY", unit, score };
  }

  if (
    input.rule.allowCrossSeed &&
    input.feedId &&
    !input.state.crossSeedFeedIds.includes(input.feedId)
  ) {
    return {
      accepted: true,
      action: "CROSS_SEED",
      unit,
      score,
      state: input.state,
      forceDuplicate: true,
      reason: "accepted for cross-seed feed"
    };
  }

  const upgradeReason = acceptedUpgradeReason(input.rule, score, input.state);
  if (upgradeReason) {
    return {
      accepted: true,
      action: "UPGRADE",
      unit,
      score,
      state: input.state,
      reason: upgradeReason
    };
  }

  return {
    accepted: false,
    reason: "media unit is already satisfied"
  };
}

function acquisitionUnitFromCandidate(
  candidate: CandidateInput,
  rule: NormalizedSubscriptionRule
): AcquisitionUnit | undefined {
  const mediaTitle = candidate.activeMatch?.mediaTitle;
  if (!mediaTitle) return undefined;

  if (mediaTitle.mediaType === "MOVIE") {
    return {
      contentKey: `movie:${mediaTitle.id}`,
      mediaTitleId: mediaTitle.id,
      unitType: "MOVIE"
    };
  }

  const season = candidate.release.season;
  if (season === undefined) return undefined;

  const seasonKey = `tv:${mediaTitle.id}:s${padNumber(season)}`;
  if (candidate.release.tvUnitType === "SPECIAL") {
    const specialNumber = candidate.release.specialNumber;
    if (specialNumber === undefined) return undefined;
    return {
      contentKey: `${seasonKey}:sp:${specialNumber}`,
      mediaTitleId: mediaTitle.id,
      unitType: "TV_SPECIAL",
      season,
      specialNumber
    };
  }

  if (candidate.release.episode === undefined) {
    return {
      contentKey: `${seasonKey}:season`,
      mediaTitleId: mediaTitle.id,
      unitType: "TV_SEASON",
      season
    };
  }

  const episodeEnd =
    candidate.release.episodeEnd !== undefined &&
    candidate.release.episodeEnd > candidate.release.episode
      ? candidate.release.episodeEnd
      : undefined;
  const variant = rule.separateVariants
    ? normalizeReleaseVariant(candidate.release.variant)
    : undefined;
  const episodePart = normalizeEpisodePart(candidate.release.episodePart);
  const contentKeyParts = [
    episodeEnd
      ? `${seasonKey}:e${padNumber(candidate.release.episode)}-e${padNumber(episodeEnd)}`
      : `${seasonKey}:e${padNumber(candidate.release.episode)}`,
    variant ? `variant:${variant}` : undefined,
    episodePart ? `part:${episodePart}` : undefined
  ].filter((part): part is string => Boolean(part));

  return {
    contentKey: contentKeyParts.join(":"),
    mediaTitleId: mediaTitle.id,
    unitType: "TV_EPISODE",
    season,
    episode: candidate.release.episode,
    episodeEnd,
    episodePart,
    variant
  };
}

function scoreRelease(
  candidate: CandidateInput,
  rule: NormalizedSubscriptionRule
): ReleaseScore {
  const source = normalizeSource(candidate.release.source) ?? null;
  const releaseGroup = normalizeReleaseGroup(candidate.release.releaseGroup) ?? null;
  return {
    resolution: releaseResolution(candidate),
    source,
    sourceRank: source ? SOURCE_RANKS[source] ?? 0 : 0,
    releaseGroup,
    preferredReleaseGroup: Boolean(
      releaseGroup && rule.preferredReleaseGroups.includes(releaseGroup)
    )
  };
}

function acceptedUpgradeReason(
  rule: NormalizedSubscriptionRule,
  score: ReleaseScore,
  state: AcquisitionState
): string | undefined {
  if (rule.upgradePolicy === "better_quality" && isBetterQuality(score, state)) {
    return "accepted as quality upgrade";
  }

  if (
    rule.upgradePolicy === "preferred_release_group" &&
    isPreferredReleaseGroupUpgrade(rule, score, state)
  ) {
    return "accepted as preferred release group upgrade";
  }

  return undefined;
}

function isBetterQuality(score: ReleaseScore, state: AcquisitionState) {
  if (
    score.resolution !== null &&
    score.resolution > (state.currentResolution ?? -1)
  ) {
    return true;
  }

  if (score.resolution !== state.currentResolution) return false;
  return score.sourceRank > (state.currentSourceRank ?? -1);
}

function isPreferredReleaseGroupUpgrade(
  rule: NormalizedSubscriptionRule,
  score: ReleaseScore,
  state: AcquisitionState
) {
  if (!score.releaseGroup || !rule.preferredReleaseGroups.includes(score.releaseGroup)) {
    return false;
  }
  const existingGroup = normalizeReleaseGroup(state.currentReleaseGroup);
  return !existingGroup || !rule.preferredReleaseGroups.includes(existingGroup);
}

function releaseResolution(candidate: CandidateInput): number | null {
  if (candidate.release.resolution !== undefined) return candidate.release.resolution;
  if (candidate.release.quality) {
    try {
      return normalizeResolution(candidate.release.quality);
    } catch {
      // Quality strings frequently contain source names; fall back to the raw title.
    }
  }
  const match = candidate.rawTitle.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  return match ? normalizeResolution(match[1]) : null;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeEpisodePart(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return /^\d+$/u.test(normalized)
    ? String(Number(normalized))
    : normalized.toUpperCase();
}
