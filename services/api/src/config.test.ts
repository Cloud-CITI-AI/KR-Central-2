import { ConfigError, parseConfig } from "@kr/config";
import { describe, expect, it } from "vitest";
import { ApiConfigSchema } from "./config.js";

const valid = {
  APP_ENV: "staging",
  DATABASE_URL: "postgres://tracker_app:x@db:5432/tracker",
  PUBLIC_BASE_URL: "https://tracker.example.com",
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_CLIENT_SECRET: "a-fake-client-secret-value",
  LOG_PSEUDONYM_SALT: "a-fake-salt-value-1234",
  S3_ENDPOINT: "https://storage.example.com",
  S3_BUCKET: "tracker-files",
  S3_ACCESS_KEY_ID: "fake",
  S3_SECRET_ACCESS_KEY: "fake-secret-key-123456",
};

describe("API config", () => {
  it("applies secure defaults", () => {
    const c = parseConfig(ApiConfigSchema, valid);
    expect(c.MALWARE_SCAN_MODE).toBe("required");
    expect(c.UPLOAD_MAX_BYTES).toBe(52_428_800);
    expect(c.KR_STAFF_EMAIL_DOMAINS).toEqual(["krsurveys.com.au"]);
    expect(c.FEATURE_AI_STAMP_READING).toBe(false);
  });

  it("refuses to disable malware scanning outside local", () => {
    expect(() => parseConfig(ApiConfigSchema, { ...valid, MALWARE_SCAN_MODE: "disabled" })).toThrow(ConfigError);
  });

  it("requires https outside local", () => {
    expect(() => parseConfig(ApiConfigSchema, { ...valid, PUBLIC_BASE_URL: "http://tracker.example.com" })).toThrow(
      ConfigError,
    );
  });

  it("pins the identity provider host in staging and production", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(() =>
        parseConfig(ApiConfigSchema, { ...valid, APP_ENV, ENTRA_AUTHORITY_HOST: "https://idp.attacker.example" }),
      ).toThrow(ConfigError);
    }
    expect(
      parseConfig(ApiConfigSchema, { ...valid, APP_ENV: "preview", ENTRA_AUTHORITY_HOST: "https://mock-idp.example" })
        .ENTRA_AUTHORITY_HOST,
    ).toBe("https://mock-idp.example");
  });

  it("defaults rate limits, body limit and bind address to the spec values", () => {
    const c = parseConfig(ApiConfigSchema, valid);
    expect([
      c.RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP,
      c.RATE_LIMIT_WRITES_PER_MINUTE,
      c.RATE_LIMIT_UPLOADS_PER_MINUTE,
      c.RATE_LIMIT_READS_PER_MINUTE,
    ]).toEqual([20, 120, 30, 600]);
    expect(c.JSON_BODY_LIMIT_BYTES).toBe(102_400);
    expect(c.HOST).toBe("::");
    expect(c.TRUST_PROXY_HOPS).toBe(1);
  });

  it("requires an authentication context id when MFA evidence is acrs", () => {
    expect(() => parseConfig(ApiConfigSchema, { ...valid, ADMIN_MFA_EVIDENCE: "acrs" })).toThrow(ConfigError);
    expect(
      parseConfig(ApiConfigSchema, { ...valid, ADMIN_MFA_EVIDENCE: "acrs", ENTRA_ADMIN_AUTH_CONTEXT_ID: "c1" })
        .ENTRA_ADMIN_AUTH_CONTEXT_ID,
    ).toBe("c1");
  });
});
