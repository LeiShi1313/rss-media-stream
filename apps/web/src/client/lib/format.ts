import { formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import i18n from "../i18n.js";

export function relativeTime(value: string | Date) {
  return formatDistanceToNow(new Date(value), {
    addSuffix: true,
    locale: i18n.resolvedLanguage?.startsWith("zh") ? zhCN : enUS
  });
}

export function formatBytes(value: string, unknownLabel = "Unknown") {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return unknownLabel;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}
