import { describe, expect, it } from "vitest";
import { createTestApp, dummyDb } from "../../test/helpers/index.js";

describe("security headers", () => {
  it("sends helmet's hardening headers and a deny-all CSP on success and on problem responses", async () => {
    const t = await createTestApp({ db: dummyDb() });
    for (const url of ["/healthz", "/v1/nope"]) {
      const h = (await t.app.inject({ url })).headers;
      expect(h["x-content-type-options"], url).toBe("nosniff");
      expect(h["content-security-policy"], url).toBe("default-src 'none';frame-ancestors 'none'");
      expect(h["strict-transport-security"], url).toBe("max-age=31536000; includeSubDomains");
      expect(h["referrer-policy"], url).toBe("no-referrer");
      expect(h["cross-origin-resource-policy"], url).toBe("same-origin");
      expect(h["x-frame-options"], url).toBeDefined();
      expect(h["x-powered-by"], url).toBeUndefined();
      expect(h["cache-control"], url).toBe("no-store");
    }
    await t.close();
  });
});
