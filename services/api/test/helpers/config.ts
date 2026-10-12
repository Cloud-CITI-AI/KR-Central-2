/** Fake, non-secret configuration for tests. Override per test (e.g. low rate limits). */
import { parseConfig } from "@kr/config";
import { ApiConfigSchema, type ApiConfig } from "../../src/config.js";

export const TEST_ORIGIN = "https://tracker.test";

export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  APP_ENV: "local",
  LOG_LEVEL: "debug",
  DATABASE_URL: "postgres://tracker_app:unused@localhost:5432/tracker",
  PUBLIC_BASE_URL: TEST_ORIGIN,
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_CLIENT_SECRET: "fake-client-secret-for-tests",
  LOG_PSEUDONYM_SALT: "fake-log-salt-for-tests",
  REQUIRE_MFA_FOR_ADMIN: "false",
  S3_ENDPOINT: "http://localhost:9090",
  S3_BUCKET: "tracker-files-test",
  S3_ACCESS_KEY_ID: "fake-access-key",
  S3_SECRET_ACCESS_KEY: "fake-secret-access-key",
};

export function testConfig(overrides: Readonly<Record<string, string>> = {}): ApiConfig {
  return parseConfig(ApiConfigSchema, { ...TEST_ENV, ...overrides });
}
