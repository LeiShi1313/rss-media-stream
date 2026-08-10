import { useTranslation } from "react-i18next";
import type { RatingDto } from "@rss-media/shared/apiContracts";
import {
  formatNativeRating,
  formatRatingFetchedAt,
  formatRatingScore,
  formatRatingVoteCount
} from "../../lib/ratings.js";
import { Tooltip } from "../ui/index.js";

export function RatingBadge({ rating }: { rating?: RatingDto }) {
  const { i18n, t } = useTranslation();
  if (!rating) return null;

  const locale = i18n.resolvedLanguage;
  const score = formatRatingScore(rating, locale);
  const votes = formatRatingVoteCount(rating, locale);
  const fetchedAt = rating.fetchedAt
    ? formatRatingFetchedAt(rating, locale)
    : undefined;

  return (
    <Tooltip content={(
      <span className="rating-tooltip">
        <strong>{rating.providerLabel}</strong>
        <span><b>{t("overview.rating.source")}</b>{rating.providerSourceLabel}</span>
        <span><b>{t("overview.rating.score")}</b>{formatNativeRating(rating, locale)}</span>
        {votes && <span><b>{t("overview.rating.votes")}</b>{votes}</span>}
        {fetchedAt && <span><b>{t("overview.rating.fetchedAt")}</b>{fetchedAt}</span>}
      </span>
    )}>
      <span
        aria-label={t("overview.rating.scoreLabel", {
          provider: rating.providerLabel,
          score
        })}
        className="poster-rating-badge"
      >
        {score}
      </span>
    </Tooltip>
  );
}
