export function normalizeTitleKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/(?<=\p{Script=Latin})\p{Mark}+/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
