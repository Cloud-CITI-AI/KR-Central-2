/**
 * Ops jobs configuration — the only place in this package that reads process.env (BE-2). Listed in .env.example.
 * The `migrate` service is the ONLY Railway service that receives MIGRATION_DATABASE_URL (ADR-0007/0008): the api and
 * the backup cron never hold DDL credentials. `backup` dumps as the read-only tracker_backup role (BACKUP_DATABASE_URL),
 * so each process has its own schema and requires only its own database URL.
 */
import {
  AppEnv,
  BooleanFromString,
  ConfigError,
  LogLevel,
  NodeEnv,
  OptionalVar,
  PostgresUrl,
  Secret,
  loadConfig,
  refineNoPlaceholders,
} from "@kr/config";
import { z } from "zod";

const OpsBase = z.object({
  NODE_ENV: NodeEnv.default("production"),
  APP_ENV: AppEnv.default("local"),
  LOG_LEVEL: LogLevel.default("info"),
  /** Health endpoint of the migrate service: 200 only after migrations succeeded (Railway healthcheck gate). */
  PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  /** Bind address of that endpoint: `::` is dual-stack, which Railway's private network (IPv6) needs. */
  HOST: z.string().min(1).default("::"),

  DATABASE_SSL: BooleanFromString.default(false),

  /** Private backup bucket (separate from the files bucket; Railway Buckets have no versioning). */
  BACKUP_S3_ENDPOINT: z.url(),
  BACKUP_S3_REGION: z.string().min(1).default("auto"),
  BACKUP_S3_BUCKET: z.string().min(3).max(63),
  BACKUP_S3_ACCESS_KEY_ID: z.string().min(1),
  BACKUP_S3_SECRET_ACCESS_KEY: Secret(16),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(7).max(400).default(35),

  /** Source files bucket, read-only credentials (nightly object copy). */
  S3_ENDPOINT: OptionalVar(z.url()),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: OptionalVar(z.string().min(3).max(63)),
  S3_ACCESS_KEY_ID: OptionalVar(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: OptionalVar(Secret(16)),
  S3_FORCE_PATH_STYLE: BooleanFromString.default(true),

  /** pg_dump 17 binary. The child process gets no PATH, so use an absolute path unless it is in /usr/bin or /bin. */
  PG_DUMP_PATH: z.string().min(1).default("pg_dump"),
  RELEASE_VERSION: z.string().default("dev"),
});

const PLACEHOLDER_KEYS = [
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/** The `migrate` service: tracker_migrator (DDL) credentials, applied before the api starts. Never set elsewhere. */
export const MigrateConfigSchema = OpsBase.extend({ MIGRATION_DATABASE_URL: PostgresUrl }).superRefine(
  refineNoPlaceholders([...PLACEHOLDER_KEYS, "MIGRATION_DATABASE_URL"]),
);

/** The `backup` cron: the read-only tracker_backup role. It does not read, and need not be given, MIGRATION_DATABASE_URL. */
export const BackupConfigSchema = OpsBase.extend({ BACKUP_DATABASE_URL: PostgresUrl }).superRefine(
  refineNoPlaceholders([...PLACEHOLDER_KEYS, "BACKUP_DATABASE_URL"]),
);

export type MigrateConfig = z.infer<typeof MigrateConfigSchema>;
export type BackupConfig = z.infer<typeof BackupConfigSchema>;

type Env = Readonly<Record<string, string | undefined>>;

export function loadMigrateConfig(env: Env = process.env): MigrateConfig {
  return loadConfig(MigrateConfigSchema, env);
}

export function loadBackupConfig(env: Env = process.env): BackupConfig {
  return loadConfig(BackupConfigSchema, env);
}

export interface SourceBucketConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

/** The files bucket (read-only credentials) is optional for `migrate` but required by `backup`: names what is missing. */
export function requireSourceBucket(config: BackupConfig): SourceBucketConfig {
  const missing = (["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter(
    (name) => config[name] === undefined,
  );
  if (
    missing.length > 0 ||
    config.S3_ENDPOINT === undefined ||
    config.S3_BUCKET === undefined ||
    config.S3_ACCESS_KEY_ID === undefined ||
    config.S3_SECRET_ACCESS_KEY === undefined
  ) {
    throw new ConfigError(missing);
  }
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  };
}
