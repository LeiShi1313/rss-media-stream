import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("redacts RSS passkeys in query strings", () => {
    const redacted = redactSecrets(
      "https://ourbits.club/torrentrss.php?passkey=251c8bdff86ad793024f31e1d97860c9&rows=10&linktype=dl"
    );
    expect(redacted).toContain("passkey=[REDACTED]");
    expect(redacted).not.toContain("251c8bdff86ad793024f31e1d97860c9");
  });

  it("keeps JSON valid when a passkey is the last URL query value", () => {
    const json = JSON.stringify({
      enclosure: {
        url: "https://example.test/download.php?id=123&passkey=251c8bdff86ad793024f31e1d97860c9"
      }
    });
    const redacted = redactSecrets(json);

    expect(JSON.parse(redacted)).toEqual({
      enclosure: {
        url: "https://example.test/download.php?id=123&passkey=[REDACTED]"
      }
    });
    expect(redacted).not.toContain("251c8bdff86ad793024f31e1d97860c9");
  });
});
