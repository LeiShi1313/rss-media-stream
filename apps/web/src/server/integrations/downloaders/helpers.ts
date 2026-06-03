export function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function normalizeTags(tags: string[] | null | undefined): string | undefined {
  if (!tags) return undefined;
  return tags.join(",");
}
