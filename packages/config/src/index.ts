/**
 * Typed environment configuration (playbook BE-2 / CF-1): each service declares a zod schema in its own
 * src/config.ts and calls loadConfig() once at startup. Invalid config prints variable NAMES only (never values)
 * and exits non-zero.
 */
import { z } from "zod";

export const NodeEnv = z.enum(["development", "test", "production"]);
export const AppEnv = z
  .enum(["local", "preview", "staging", "production"])
  .meta({ description: "Deployment environment name (logs, telemetry)" });
export const LogLevel = z.enum(["debug", "info", "warn", "error"]);
export const Port = z.coerce.number().int().min(1).max(65535);

/** "true"/"false"/"1"/"0" → boolean (env vars are strings; z.coerce.boolean would treat "false" as true). */
export const BooleanFromString = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

/** Comma-separated list → trimmed non-empty strings. */
export const CsvList = z.string().transform((v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const PostgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL");

export const HttpsUrl = z.url().refine((v) => v.startsWith("https://"), "must be an https:// URL");

/**
 * An optional variable: unset or empty means "not set". Railway's raw editor (and .env.example) create empty strings
 * for blank entries, which must not crash startup; a non-empty value is still validated by `schema`.
 */
export const OptionalVar = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/** Secrets: at least `min` characters; never logged. */
export const Secret = (min = 32) => z.string().min(min);

export class ConfigError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid configuration: ${variables.join(", ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Fail closed on a missing APP_ENV. Every production guardrail keys off APP_ENV (malware scanning, https, the pinned
 * identity provider, placeholder secrets), and the images set NODE_ENV=production but not APP_ENV, so a forgotten
 * variable must not silently mean "local". Applies to any object schema declaring both NODE_ENV and APP_ENV: when
 * NODE_ENV is production (also its default) APP_ENV must be set explicitly (an empty value counts as missing).
 */
function appEnvMissing(schema: z.ZodType, env: Readonly<Record<string, string | undefined>>): boolean {
  if (!(schema instanceof z.ZodObject) || !("APP_ENV" in schema.shape) || !("NODE_ENV" in schema.shape)) return false;
  const nodeEnv = env.NODE_ENV === undefined || env.NODE_ENV === "" ? "production" : env.NODE_ENV;
  return nodeEnv === "production" && (env.APP_ENV === undefined || env.APP_ENV === "");
}

/** Parse without exiting (for tests). Throws ConfigError listing the offending variable names. */
export function parseConfig<T extends z.ZodType>(
  schema: T,
  env: Readonly<Record<string, string | undefined>>,
): z.infer<T> {
  const missingAppEnv = appEnvMissing(schema, env);
  const r = schema.safeParse(env);
  if (!r.success || missingAppEnv) {
    const names = r.success ? [] : r.error.issues.map((i) => i.path.join(".") || "(root)");
    throw new ConfigError([...new Set(missingAppEnv ? ["APP_ENV", ...names] : names)]);
  }
  return r.data;
}

/** Parse once at startup; on failure print variable names (not values) and exit(1). */
export function loadConfig<T extends z.ZodType>(
  schema: T,
  env: Readonly<Record<string, string | undefined>> = process.env,
): z.infer<T> {
  try {
    return parseConfig(schema, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "config_invalid", variables: err.variables })}\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}
