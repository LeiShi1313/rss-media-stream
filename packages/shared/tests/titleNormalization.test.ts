import { describe, expect, it } from "vitest";
import { normalizeTitleKey } from "../src/titleNormalization.js";

describe("normalizeTitleKey", () => {
  it("preserves non-Latin letters instead of collapsing them to an empty key", () => {
    expect(normalizeTitleKey("为时已是寿司！？")).toBe("为时已是寿司");
    expect(normalizeTitleKey("クジマ歌えば家ほろろ")).toBe("クジマ歌えば家ほろろ");
    expect(normalizeTitleKey("女骑士成为蛮族新娘")).toBe("女骑士成为蛮族新娘");
  });

  it("normalizes Latin punctuation and accents", () => {
    expect(normalizeTitleKey("Dernier été à Tanger")).toBe("dernier ete a tanger");
    expect(normalizeTitleKey("Mr. K")).toBe("mr k");
  });
});
