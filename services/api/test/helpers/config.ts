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
  ENTRA_CLIENT_SECRET: "client-secret-for-tests-0123",
  LOG_PSEUDONYM_SALT: "log-salt-for-tests-0123456",
  REQUIRE_MFA_FOR_ADMIN: "false",
  S3_ENDPOINT: "http://localhost:9090",
  S3_BUCKET: "tracker-files-test",
  S3_ACCESS_KEY_ID: "access-key-for-tests",
  S3_SECRET_ACCESS_KEY: "secret-access-key-for-tests-0123",
};

export function testConfig(overrides: Readonly<Record<string, string>> = {}): ApiConfig {
  return parseConfig(ApiConfigSchema, { ...TEST_ENV, ...overrides });
}
