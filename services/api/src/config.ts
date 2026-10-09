/**
 * API configuration — the only place that reads process.env (BE-2). Every variable is listed in .env.example (CF-3)
 * and in docs/deploy/railway.md. Invalid config → names printed, process exits 1.
 */
import {
  AppEnv,
  BooleanFromString,
  CsvList,
  LogLevel,
  NodeEnv,
  Port,
  PostgresUrl,
  Secret,
  loadConfig,
} from "@kr/config";
import { z } from "zod";

/** The only identity provider host allowed in staging/production (a wrong value would be a sign-in bypass). */
export const ENTRA_PUBLIC_AUTHORITY = "https://login.microsoftonline.com";

export const ApiConfigSchema = z
  .object({
    NODE_ENV: NodeEnv.default("production"),
    APP_ENV: AppEnv.default("local"),
    PORT: Port.default(8080),
    /** Bind address. '::' listens on IPv6 and IPv4 (Railway private networking is IPv6 in older environments). */
    HOST: z.string().min(1).default("::"),
    LOG_LEVEL: LogLevel.default("info"),
    /**
     * Trusted proxy hops between the client and the API. The web BFF forwards the X-Forwarded-For it received from
     * the Railway edge unchanged, so only the BFF hop is trusted (1). Verify in staging (docs/deploy/railway.md).
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

    DATABASE_URL: PostgresUrl.meta({ description: "tracker_app role (DML only)" }),
    DATABASE_SSL: BooleanFromString.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

    /** Public origin of the web app, e.g. https://tracker.krsurveys.com.au (redirect URIs, Origin/CSRF checks). */
    PUBLIC_BASE_URL: z.url(),

    ENTRA_TENANT_ID: z.uuid(),
    ENTRA_CLIENT_ID: z.uuid(),
    ENTRA_CLIENT_SECRET: Secret(16),
    /** Override only for tests/e2e (local mock IdP). Pinned to Microsoft's host in staging/production (refine below). */
    ENTRA_AUTHORITY_HOST: z.url().default("https://login.microsoftonline.com"),
    /** Email domains of KR staff accounts (members of the tenant). Members with other domains become 'external'. */
    KR_STAFF_EMAIL_DOMAINS: CsvList.default(["krsurveys.com.au"]),

    SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(120),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    /** Salt for pseudonymising identifiers in security logs (LG-3). */
    LOG_PSEUDONYM_SALT: Secret(16),
    /** Admin/kr_admin-only endpoints require MFA evidence in the ID token; docs/07 §7.4, ADR-0002. */
    REQUIRE_MFA_FOR_ADMIN: BooleanFromString.default(true),
    /**
     * Which claim proves MFA: 'amr' (contains "mfa") or 'acrs' (contains ENTRA_ADMIN_AUTH_CONTEXT_ID, a Conditional
     * Access authentication context). Which one Entra emits for this app must be proven in staging (go-live gate).
     */
    ADMIN_MFA_EVIDENCE: z.enum(["amr", "acrs"]).default("amr"),
    ENTRA_ADMIN_AUTH_CONTEXT_ID: z
      .string()
      .regex(/^c([1-9]|[1-9][0-9])$/)
      .optional(),

    /** Rate limits (PRODUCT_SPEC §14); 429 + Retry-After. */
    RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_WRITES_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    RATE_LIMIT_UPLOADS_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    RATE_LIMIT_READS_PER_MINUTE: z.coerce.number().int().min(1).default(600),
    /** JSON request body limit (PRODUCT_SPEC §14: 100 KB). Uploads use UPLOAD_MAX_BYTES. */
    JSON_BODY_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1024 * 1024)
      .default(100 * 1024),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(3).max(63),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: Secret(16),
    S3_FORCE_PATH_STYLE: BooleanFromString.default(true),

    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(200 * 1024 * 1024)
      .default(50 * 1024 * 1024),
    /** required: files are downloadable only after a clean ClamAV scan; disabled: marked 'skipped' (local dev only). */
    MALWARE_SCAN_MODE: z.enum(["required", "disabled"]).default("required"),

    FEATURE_AI_STAMP_READING: BooleanFromString.default(false),
    FEATURE_ENTRA_GUEST_INVITES: BooleanFromString.default(false),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    RELEASE_VERSION: z.string().default("dev"),
  })
  .refine((c) => c.NODE_ENV !== "production" || c.MALWARE_SCAN_MODE === "required" || c.APP_ENV === "local", {
    message: "MALWARE_SCAN_MODE=disabled is not allowed outside local",
    path: ["MALWARE_SCAN_MODE"],
  })
  .refine((c) => c.APP_ENV === "local" || c.PUBLIC_BASE_URL.startsWith("https://"), {
    message: "PUBLIC_BASE_URL must be https outside local",
    path: ["PUBLIC_BASE_URL"],
  })
  .refine((c) => c.APP_ENV === "local" || c.ENTRA_AUTHORITY_HOST.startsWith("https://"), {
    message: "ENTRA_AUTHORITY_HOST must be https outside local",
    path: ["ENTRA_AUTHORITY_HOST"],
  })
  .refine(
    (c) =>
      !(c.APP_ENV === "staging" || c.APP_ENV === "production") ||
      c.ENTRA_AUTHORITY_HOST.replace(/\/+$/, "") === ENTRA_PUBLIC_AUTHORITY,
    {
      message: `ENTRA_AUTHORITY_HOST must be ${ENTRA_PUBLIC_AUTHORITY} in staging and production`,
      path: ["ENTRA_AUTHORITY_HOST"],
    },
  )
  .refine((c) => c.ADMIN_MFA_EVIDENCE !== "acrs" || Boolean(c.ENTRA_ADMIN_AUTH_CONTEXT_ID), {
    message: "ADMIN_MFA_EVIDENCE=acrs requires ENTRA_ADMIN_AUTH_CONTEXT_ID",
    path: ["ENTRA_ADMIN_AUTH_CONTEXT_ID"],
  });

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function loadApiConfig(env: Readonly<Record<string, string | undefined>> = process.env): ApiConfig {
  return loadConfig(ApiConfigSchema, env);
}
