import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/server/secrets.js";

describe("secret encryption", () => {
  it("round-trips encrypted values", () => {
    const secret = "long-test-secret-for-unit-tests";
    const encrypted = encryptSecret("https://example.test/rss?passkey=abc", secret);
    expect(encrypted).not.toContain("passkey");
    expect(decryptSecret(encrypted, secret)).toBe("https://example.test/rss?passkey=abc");
  });
});
