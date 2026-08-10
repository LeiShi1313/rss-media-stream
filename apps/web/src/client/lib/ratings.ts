import type { RatingDto } from "@rss-media/shared/apiContracts";

type NativeRating = Pick<RatingDto, "value" | "scale" | "voteCount" | "fetchedAt">;

export function formatRatingScore(rating: NativeRating, locale?: string) {
  return formatRatingNumber(rating.value, locale);
}

export function formatNativeRating(rating: NativeRating, locale?: string) {
  return `${formatRatingNumber(rating.value, locale)}/${formatRatingNumber(rating.scale, locale)}`;
}

export function formatRatingVoteCount(rating: NativeRating, locale?: string) {
  return typeof rating.voteCount === "number"
    ? new Intl.NumberFormat(locale).format(rating.voteCount)
    : undefined;
}

export function formatRatingFetchedAt(rating: NativeRating, locale?: string) {
  if (!rating.fetchedAt) return undefined;
  const fetchedAt = new Date(rating.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(fetchedAt);
}

export function formatRatingNumber(value: number, locale?: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2
  }).format(value);
}
