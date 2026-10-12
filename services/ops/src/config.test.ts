import { readFileSync } from "node:fs";
import { ConfigError, parseConfig } from "@kr/config";
import { describe, expect, it } from "vitest";
import { BackupConfigSchema, MigrateConfigSchema, requireSourceBucket } from "./config.js";

const shared = {
  APP_ENV: "staging",
  BACKUP_S3_ENDPOINT: "https://storage.example.com",
  BACKUP_S3_BUCKET: "tracker-backups",
  BACKUP_S3_ACCESS_KEY_ID: "access-key-test",
  BACKUP_S3_SECRET_ACCESS_KEY: "sk-test-0123456789abcdef",
};
const MIGRATOR_URL = "postgres://tracker_migrator:x@db:5432/tracker";
const BACKUP_URL = "postgres://tracker_backup:y@db:5432/tracker";
const valid = { ...shared, BACKUP_DATABASE_URL: BACKUP_URL };
const validMigrate = { ...shared, MIGRATION_DATABASE_URL: MIGRATOR_URL };

describe("ops config", () => {
  it("parses a minimal migrate-service environment with defaults", () => {
    const c = parseConfig(MigrateConfigSchema, validMigrate);
    expect(c.PORT).toBe(8082);
    expect(c.HOST).toBe("::");
    expect(c.BACKUP_RETENTION_DAYS).toBe(35);
  });

  it("requires the migrator URL for migrate, and nothing else about the database", () => {
    expect(parseConfig(MigrateConfigSchema, validMigrate).MIGRATION_DATABASE_URL).toBe(MIGRATOR_URL);
    expect(() => parseConfig(MigrateConfigSchema, shared)).toThrow(ConfigError);
    // The migrate service holds no backup-role credentials.
    expect(() => parseConfig(MigrateConfigSchema, validMigrate)).not.toThrow();
  });

  it("requires BACKUP_DATABASE_URL, not the migrator URL, for backup (ADR-0008)", () => {
    const c = parseConfig(BackupConfigSchema, valid);
    expect(c.BACKUP_DATABASE_URL).toBe(BACKUP_URL);
    expect(c).not.toHaveProperty("MIGRATION_DATABASE_URL");
    expect(() => parseConfig(BackupConfigSchema, shared)).toThrow(ConfigError);
    // Handing the backup cron only DDL credentials is not enough: it needs its own read-only role.
    expect(() => parseConfig(BackupConfigSchema, validMigrate)).toThrow(ConfigError);
    // A migrator URL present in its environment is never copied into the backup configuration.
    expect(parseConfig(BackupConfigSchema, { ...valid, MIGRATION_DATABASE_URL: MIGRATOR_URL })).not.toHaveProperty(
      "MIGRATION_DATABASE_URL",
    );
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
    const c = requireSourceBucket(parseConfig(BackupConfigSchema, { ...valid, ...source }));
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
        return requireSourceBucket(parseConfig(BackupConfigSchema, { ...valid, ...partial }));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variables).toEqual(["S3_BUCKET", "S3_ACCESS_KEY_ID"]);
  });

  it("treats empty optional variables (a pasted .env.example) as unset", () => {
    const c = parseConfig(BackupConfigSchema, {
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
    expect(() => parseConfig(BackupConfigSchema, { ...valid, BACKUP_S3_BUCKET: "" })).toThrow(ConfigError);
  });

  it("fails closed when APP_ENV is missing in production", () => {
    const { APP_ENV: _omit, ...rest } = valid;
    try {
      parseConfig(BackupConfigSchema, rest);
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toEqual(["APP_ENV"]);
    }
    expect(parseConfig(BackupConfigSchema, { ...rest, NODE_ENV: "test" }).APP_ENV).toBe("local");
  });

  it("refuses the .env.example placeholder secrets in staging and production", () => {
    const cases = [
      [
        BackupConfigSchema,
        valid,
        { BACKUP_DATABASE_URL: "postgres://tracker_backup:local-backup-password@db:5432/tracker" },
      ],
      [
        MigrateConfigSchema,
        validMigrate,
        { MIGRATION_DATABASE_URL: "postgres://tracker_migrator:local-migrator-password@db:5432/tracker" },
      ],
    ] as const;
    for (const APP_ENV of ["staging", "production"]) {
      for (const [schema, base, own] of cases) {
        for (const [k, v] of Object.entries({
          ...own,
          BACKUP_S3_SECRET_ACCESS_KEY: "fake-backup-secret-access-key",
          BACKUP_S3_ACCESS_KEY_ID: "fake-backup-access-key",
          S3_SECRET_ACCESS_KEY: "fake-secret-access-key",
        }))
          expect(() => parseConfig(schema, { ...base, [k]: v, APP_ENV }), `${APP_ENV} ${k}`).toThrow(ConfigError);
      }
    }
    expect(
      parseConfig(BackupConfigSchema, {
        ...valid,
        APP_ENV: "local",
        BACKUP_S3_SECRET_ACCESS_KEY: "fake-backup-secret-access-key",
        BACKUP_DATABASE_URL: "postgres://tracker_backup:local-backup-password@db:5432/tracker",
      }).APP_ENV,
    ).toBe("local");
  });
});

describe(".env.example parity", () => {
  const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const listed = new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

  it("lists every variable of the migrate and backup schemas", () => {
    const keys = [...Object.keys(MigrateConfigSchema.shape), ...Object.keys(BackupConfigSchema.shape)];
    expect(keys.filter((k) => !listed.has(k))).toEqual([]);
  });
});
