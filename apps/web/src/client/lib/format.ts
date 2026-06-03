import { formatDistanceToNow } from "date-fns";

export function tmdbImage(path: string, size: "w185" | "w342") {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function relativeTime(value: string | Date) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "Unknown";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}

