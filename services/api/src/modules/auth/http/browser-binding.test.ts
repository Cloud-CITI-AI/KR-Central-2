import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "../data/auth-flows.js";
import { matchesBinding, newBindingValue } from "./browser-binding.js";
import { redirectUri } from "./oidc.js";

describe("browser binding", () => {
  it("issues 256 random bits as base64url", () => {
    const [a, b] = [newBindingValue(), newBindingValue()];
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("matches only the value whose SHA-256 was stored", () => {
    const value = newBindingValue();
    expect(matchesBinding(value, sha256(value))).toBe(true);
    expect(matchesBinding(newBindingValue(), sha256(value))).toBe(false);
  });

  it.each([undefined, "", "short", `${newBindingValue()}x`, "!".repeat(43)])(
    "refuses the presented value %j",
    (presented) => {
      expect(matchesBinding(presented, sha256(randomBytes(32).toString("base64url")))).toBe(false);
    },
  );
});

describe("redirectUri", () => {
  it("is the callback under the public origin, whatever path the origin was configured with", () => {
    expect(redirectUri({ PUBLIC_BASE_URL: "https://tracker.krsurveys.com.au" })).toBe(
      "https://tracker.krsurveys.com.au/api/v1/auth/callback",
    );
    expect(redirectUri({ PUBLIC_BASE_URL: "https://t.test/ignored/" })).toBe("https://t.test/api/v1/auth/callback");
  });
});
