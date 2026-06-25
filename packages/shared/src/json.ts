const POSTGRES_UNSUPPORTED_TEXT_PATTERN = /\u0000/g;

export function toJsonStorageValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null, (_key, current) => {
    if (typeof current === "string") return current.replace(POSTGRES_UNSUPPORTED_TEXT_PATTERN, "");
    return current;
  }));
}

export function stringifyJsonStorageValue(value: unknown): string {
  return JSON.stringify(toJsonStorageValue(value));
}
