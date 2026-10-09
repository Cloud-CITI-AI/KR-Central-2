/** Worker configuration — the only place that reads process.env (BE-2). Listed in .env.example (CF-3). */
import { AppEnv, BooleanFromString, LogLevel, NodeEnv, PostgresUrl, Secret, loadConfig } from "@kr/config";
import { z } from "zod";

export const WorkerConfigSchema = z
  .object({
    NODE_ENV: NodeEnv.default("production"),
    APP_ENV: AppEnv.default("local"),
    LOG_LEVEL: LogLevel.default("info"),
    /** Health endpoint only. Railway sets PORT and health-checks it; 8081 is the local default. */
    PORT: z.coerce.number().int().min(1).max(65535).default(8081).meta({ description: "Health endpoint only" }),
    HOST: z.string().min(1).default("::"),

    DATABASE_URL: PostgresUrl,
    DATABASE_SSL: BooleanFromString.default(false),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(3).max(63),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: Secret(16),
    S3_FORCE_PATH_STYLE: BooleanFromString.default(true),

    MALWARE_SCAN_MODE: z.enum(["required", "disabled"]).default("required"),
    CLAMAV_HOST: z.string().min(1).default("clamav.railway.internal"),
    CLAMAV_PORT: z.coerce.number().int().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
    /** Must not exceed clamd's StreamMaxLength (infra/clamav/clamd.conf, 60M); must be ≥ UPLOAD_MAX_BYTES. */
    CLAMAV_STREAM_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .default(60 * 1024 * 1024),
    /** Same value as the api's UPLOAD_MAX_BYTES; checked against CLAMAV_STREAM_MAX_BYTES at startup. */
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(200 * 1024 * 1024)
      .default(50 * 1024 * 1024),
    /** Automatic re-scans of files whose scan ended in 'error' (hourly sweep) before the error is final. */
    SCAN_ERROR_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

    FEATURE_AI_STAMP_READING: BooleanFromString.default(false),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
    ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).default(300),
    PDF_MAX_PAGES: z.coerce.number().int().min(1).default(60),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    RELEASE_VERSION: z.string().default("dev"),
  })
  .refine((c) => !c.FEATURE_AI_STAMP_READING || Boolean(c.ANTHROPIC_API_KEY), {
    message: "FEATURE_AI_STAMP_READING requires ANTHROPIC_API_KEY",
    path: ["ANTHROPIC_API_KEY"],
  })
  .refine((c) => c.MALWARE_SCAN_MODE !== "required" || c.UPLOAD_MAX_BYTES <= c.CLAMAV_STREAM_MAX_BYTES, {
    message: "UPLOAD_MAX_BYTES exceeds CLAMAV_STREAM_MAX_BYTES: large files could never be scanned",
    path: ["CLAMAV_STREAM_MAX_BYTES"],
  })
  .refine((c) => c.APP_ENV === "local" || c.MALWARE_SCAN_MODE === "required", {
    message: "MALWARE_SCAN_MODE=disabled is not allowed outside local",
    path: ["MALWARE_SCAN_MODE"],
  });

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>> = process.env): WorkerConfig {
  return loadConfig(WorkerConfigSchema, env);
}
