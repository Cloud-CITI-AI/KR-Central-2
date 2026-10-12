/**
 * ADR-0002: the identity provider is pinned. Staging and production refuse to start unless ENTRA_AUTHORITY_HOST is
 * Microsoft's host (a wrong value would be a sign-in bypass), and the authorize request is built from configuration only,
 * never from anything the browser sent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, parseConfig } from "@kr/config";
import { startMockIdp, type MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiConfigSchema, ENTRA_PUBLIC_AUTHORITY } from "../../src/config.js";
import { createTestApp, TEST_ENV, testConfig, type TestApp } from "../helpers/index.js";
import { freshClientIp } from "../../src/modules/auth/testing.js";

const base = {
  ...TEST_ENV,
  PUBLIC_BASE_URL: "https://tracker.example.com",
  NODE_ENV: "production",
  REQUIRE_MFA_FOR_ADMIN: "true",
  // staging and production refuse the 'fake-' placeholders of TEST_ENV, so these cases bring their own values
  ENTRA_CLIENT_SECRET: "client-secret-for-tests-0123",
  LOG_PSEUDONYM_SALT: "log-salt-for-tests-0123456",
  S3_ACCESS_KEY_ID: "access-key-for-tests",
  S3_SECRET_ACCESS_KEY: "secret-access-key-for-tests-0123",
};
const parse = (env: Record<string, string>) => parseConfig(ApiConfigSchema, { ...base, ...env });
const PINNED = ["staging", "production"] as const;

describe("ENTRA_AUTHORITY_HOST is pinned outside local and preview", () => {
  it.each(PINNED)("%s starts with Microsoft's host, with or without trailing slashes", (APP_ENV) => {
    for (const host of [ENTRA_PUBLIC_AUTHORITY, `${ENTRA_PUBLIC_AUTHORITY}/`, `${ENTRA_PUBLIC_AUTHORITY}//`])
      expect(parse({ APP_ENV, ENTRA_AUTHORITY_HOST: host }).ENTRA_AUTHORITY_HOST, host).toBe(host);
  });

  it.each(PINNED)("%s refuses every other host, look-alike or scheme", (APP_ENV) => {
    const refused = [
      "https://login.microsoftonline.com.evil.example",
      "https://evil.example/login.microsoftonline.com",
      "https://login.microsoftonline.com@evil.example",
      "https://evil.example#@login.microsoftonline.com",
      "https://login.microsoftonline.us",
      "https://sts.windows.net",
      "https://login.microsoftonline.com:8443",
      "https://login.microsoftonline.com/extra/path",
      "https://LOGIN.MICROSOFTONLINE.COM",
      "http://login.microsoftonline.com",
      "http://localhost:9000",
      "https://localhost:9000",
    ];
    for (const host of refused)
      expect(() => parse({ APP_ENV, ENTRA_AUTHORITY_HOST: host }), `${APP_ENV} ${host}`).toThrow(ConfigError);
  });

  it("names the variable and never echoes the rejected value", () => {
    try {
      parse({ APP_ENV: "production", ENTRA_AUTHORITY_HOST: "https://secret-looking-host.evil.example" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("ENTRA_AUTHORITY_HOST");
      expect((error as Error).message).not.toContain("evil.example");
    }
  });

  it("cannot be sidestepped by naming the environment differently: only the four known names parse", () => {
    for (const APP_ENV of ["prod", "Production", "STAGING", " production", "production ", "prd", ""])
      expect(() => parse({ APP_ENV, ENTRA_AUTHORITY_HOST: "https://evil.example" }), APP_ENV).toThrow(ConfigError);
  });

  it("allows the mock IdP over http only in local, and requires https in preview", () => {
    const mock = "http://localhost:9000";
    expect(parse({ APP_ENV: "local", ENTRA_AUTHORITY_HOST: mock }).ENTRA_AUTHORITY_HOST).toBe(mock);
    expect(() => parse({ APP_ENV: "preview", ENTRA_AUTHORITY_HOST: mock })).toThrow(ConfigError);
  });

  it("refuses malware scanning off and a plain-http public URL outside local, so a weak config cannot start", () => {
    expect(() => parse({ APP_ENV: "staging", MALWARE_SCAN_MODE: "disabled" })).toThrow(ConfigError);
    expect(() => parse({ APP_ENV: "production", PUBLIC_BASE_URL: "http://tracker.example.com" })).toThrow(ConfigError);
  });
});

describe("the mock IdP never ships", () => {
  const root = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
  it.each(["services/api", "services/worker", "services/ops", "apps/web"])(
    "%s: a dev dependency at most, not in its image",
    (dir) => {
      const pkg = JSON.parse(readFileSync(root(`${dir}/package.json`), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@kr/mock-idp");
      expect(readFileSync(root(`${dir}/Dockerfile`), "utf8")).not.toContain("mock-idp");
    },
  );
});

describe("the authorize request comes from configuration only", () => {
  let idp: MockIdp;
  let t: TestApp;
  beforeAll(async () => {
    const c = testConfig();
    idp = await startMockIdp({
      tenantId: c.ENTRA_TENANT_ID,
      clientId: c.ENTRA_CLIENT_ID,
      clientSecret: c.ENTRA_CLIENT_SECRET,
      users: [],
    });
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  it("ignores Host, X-Forwarded-Host, X-Forwarded-Proto and Origin: the IdP and the redirect URI never move", async () => {
    const res = await t.app.inject({
      url: "/v1/auth/login",
      headers: {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
        origin: "https://evil.example",
        "x-forwarded-for": freshClientIp(),
      },
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location ?? "");
    expect(location.origin).toBe(new URL(idp.issuer).origin);
    expect(location.searchParams.get("redirect_uri")).toBe("https://tracker.test/api/v1/auth/callback");
    expect(res.body).not.toContain("evil.example");
  });
});
