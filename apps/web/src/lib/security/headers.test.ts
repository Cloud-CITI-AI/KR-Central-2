// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "../../../next.config";

describe("next.config security headers", () => {
  it("sets HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame and COOP headers on every path", async () => {
    const rules = (await config.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
    const headers = Object.fromEntries((rules[0]?.headers ?? []).map((h) => [h.key, h.value]));
    expect(headers).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("keeps the standalone output and hides X-Powered-By", () => {
    expect(config.output).toBe("standalone");
    expect(config.poweredByHeader).toBe(false);
  });
});
