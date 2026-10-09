import { ConfigError, parseConfig } from "@kr/config";
import { describe, expect, it } from "vitest";
import { OpsConfigSchema } from "./config.js";

const valid = {
  APP_ENV: "staging",
  MIGRATION_DATABASE_URL: "postgres://tracker_migrator:x@db:5432/tracker",
  BACKUP_S3_ENDPOINT: "https://storage.example.com",
  BACKUP_S3_BUCKET: "tracker-backups",
  BACKUP_S3_ACCESS_KEY_ID: "fake",
  BACKUP_S3_SECRET_ACCESS_KEY: "fake-secret-key-123456",
};

describe("ops config", () => {
  it("parses a minimal migrate-service environment with defaults", () => {
    const c = parseConfig(OpsConfigSchema, valid);
    expect(c.PORT).toBe(8082);
    expect(c.HOST).toBe("::");
    expect(c.BACKUP_RETENTION_DAYS).toBe(35);
  });

  it("requires the migrator URL", () => {
    const { MIGRATION_DATABASE_URL: _omit, ...rest } = valid;
    expect(() => parseConfig(OpsConfigSchema, rest)).toThrow(ConfigError);
  });
});
