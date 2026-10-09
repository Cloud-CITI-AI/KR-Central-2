/**
 * Ops jobs configuration — the only place in this package that reads process.env (BE-2). Listed in .env.example.
 * The `migrate` service is the ONLY Railway service that receives MIGRATION_DATABASE_URL (ADR-0007): the api never
 * holds DDL credentials.
 */
import { AppEnv, BooleanFromString, LogLevel, NodeEnv, PostgresUrl, Secret, loadConfig } from "@kr/config";
import { z } from "zod";

export const OpsConfigSchema = z.object({
  NODE_ENV: NodeEnv.default("production"),
  APP_ENV: AppEnv.default("local"),
  LOG_LEVEL: LogLevel.default("info"),
  /** Health endpoint of the migrate service: 200 only after migrations succeeded (Railway healthcheck gate). */
  PORT: z.coerce.number().int().min(1).max(65535).default(8082),

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
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().min(3).max(63).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: Secret(16).optional(),
  S3_FORCE_PATH_STYLE: BooleanFromString.default(true),

  PG_DUMP_PATH: z.string().min(1).default("pg_dump"),
  RELEASE_VERSION: z.string().default("dev"),
});

export type OpsConfig = z.infer<typeof OpsConfigSchema>;

export function loadOpsConfig(env: Readonly<Record<string, string | undefined>> = process.env): OpsConfig {
  return loadConfig(OpsConfigSchema, env);
}
