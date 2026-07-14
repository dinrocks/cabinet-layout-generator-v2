import { describe, it, expect } from "vitest";
import { newShareToken, shareUrl } from "./shareToken";

describe("share tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/); // 32 bytes → 43 base64url chars
    expect(a).not.toBe(b);
    expect(encodeURIComponent(a)).toBe(a); // no escaping needed in a URL
  });

  it("shareUrl routes to the viewer", () => {
    expect(shareUrl("tok123", "https://example.app")).toBe("https://example.app/?share=tok123");
  });
});
