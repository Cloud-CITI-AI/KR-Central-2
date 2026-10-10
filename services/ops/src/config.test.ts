import { ConfigError, parseConfig } from "@kr/config";
import { describe, expect, it } from "vitest";
import { OpsConfigSchema, requireSourceBucket } from "./config.js";

const valid = {
  APP_ENV: "staging",
  MIGRATION_DATABASE_URL: "postgres://tracker_migrator:x@db:5432/tracker",
  BACKUP_S3_ENDPOINT: "https://storage.example.com",
  BACKUP_S3_BUCKET: "tracker-backups",
  BACKUP_S3_ACCESS_KEY_ID: "access-key-test",
  BACKUP_S3_SECRET_ACCESS_KEY: "sk-test-0123456789abcdef",
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

describe("requireSourceBucket", () => {
  const source = {
    S3_ENDPOINT: "https://files.example.com",
    S3_BUCKET: "tracker-files",
    S3_ACCESS_KEY_ID: "read-only-key",
    S3_SECRET_ACCESS_KEY: "read-only-secret-1234",
  };

  it("returns the files bucket settings for the backup job", () => {
    const c = requireSourceBucket(parseConfig(OpsConfigSchema, { ...valid, ...source }));
    expect(c).toEqual({
      endpoint: "https://files.example.com",
      region: "auto",
      bucket: "tracker-files",
      accessKeyId: "read-only-key",
      secretAccessKey: "read-only-secret-1234",
      forcePathStyle: true,
    });
  });

  it("names every missing variable (and no values) when the files bucket is not configured", () => {
    const { S3_BUCKET: _bucket, S3_ACCESS_KEY_ID: _key, ...partial } = source;
    const error = (() => {
      try {
        return requireSourceBucket(parseConfig(OpsConfigSchema, { ...valid, ...partial }));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variables).toEqual(["S3_BUCKET", "S3_ACCESS_KEY_ID"]);
  });

  it("treats empty optional variables (a pasted .env.example) as unset", () => {
    const c = parseConfig(OpsConfigSchema, {
      ...valid,
      S3_ENDPOINT: "",
      S3_BUCKET: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    });
    expect(c.S3_ENDPOINT).toBeUndefined();
    expect(c.S3_SECRET_ACCESS_KEY).toBeUndefined();
    expect(() => requireSourceBucket(c)).toThrow(ConfigError);
  });

  it("keeps required variables required when empty", () => {
    expect(() => parseConfig(OpsConfigSchema, { ...valid, BACKUP_S3_BUCKET: "" })).toThrow(ConfigError);
  });

  it("fails closed when APP_ENV is missing in production", () => {
    const { APP_ENV: _omit, ...rest } = valid;
    try {
      parseConfig(OpsConfigSchema, rest);
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toEqual(["APP_ENV"]);
    }
    expect(parseConfig(OpsConfigSchema, { ...rest, NODE_ENV: "test" }).APP_ENV).toBe("local");
  });

  it("refuses the .env.example placeholder secrets in staging and production", () => {
    for (const APP_ENV of ["staging", "production"]) {
      for (const [k, v] of Object.entries({
        BACKUP_S3_SECRET_ACCESS_KEY: "fake-backup-secret-access-key",
        BACKUP_S3_ACCESS_KEY_ID: "fake-backup-access-key",
        S3_SECRET_ACCESS_KEY: "fake-secret-access-key",
        MIGRATION_DATABASE_URL: "postgres://tracker_migrator:local-migrator-password@db:5432/tracker",
      }))
        expect(() => parseConfig(OpsConfigSchema, { ...valid, [k]: v, APP_ENV }), `${APP_ENV} ${k}`).toThrow(
          ConfigError,
        );
    }
    expect(
      parseConfig(OpsConfigSchema, {
        ...valid,
        APP_ENV: "local",
        BACKUP_S3_SECRET_ACCESS_KEY: "fake-backup-secret-access-key",
      }).APP_ENV,
    ).toBe("local");
  });
});
