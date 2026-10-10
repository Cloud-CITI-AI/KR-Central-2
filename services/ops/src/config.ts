/**
 * Ops jobs configuration — the only place in this package that reads process.env (BE-2). Listed in .env.example.
 * The `migrate` service is the ONLY Railway service that receives MIGRATION_DATABASE_URL (ADR-0007): the api never
 * holds DDL credentials.
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
} from "@kr/config";
import { z } from "zod";

export const OpsConfigSchema = z.object({
  NODE_ENV: NodeEnv.default("production"),
  APP_ENV: AppEnv.default("local"),
  LOG_LEVEL: LogLevel.default("info"),
  /** Health endpoint of the migrate service: 200 only after migrations succeeded (Railway healthcheck gate). */
  PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  /** Bind address of that endpoint: `::` is dual-stack, which Railway's private network (IPv6) needs. */
  HOST: z.string().min(1).default("::"),

  /** tracker_migrator role (DDL). Never set on api/worker/web. */
  MIGRATION_DATABASE_URL: PostgresUrl,
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

export type OpsConfig = z.infer<typeof OpsConfigSchema>;

export function loadOpsConfig(env: Readonly<Record<string, string | undefined>> = process.env): OpsConfig {
  return loadConfig(OpsConfigSchema, env);
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
export function requireSourceBucket(config: OpsConfig): SourceBucketConfig {
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
