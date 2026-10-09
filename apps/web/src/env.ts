/**
 * Server-only environment (ADR-0013: parsed with zod, invalid → variable NAMES only, never values). Only
 * `NEXT_PUBLIC_*` variables reach the browser (FE-11) and this app uses none, so nothing here may be imported by a
 * client component. Parsed on each call (two keys, negligible) so tests can stub `process.env`.
 */
import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

export const EnvSchema = z.object({
  /** Private URL of the API (Railway private networking), e.g. http://api.railway.internal:8080. */
  API_INTERNAL_URL: httpUrl.transform((v) => v.replace(/\/+$/, "")),
  /** Optional "Send feedback" footer link (PRODUCT_SPEC §12); empty = hidden. */
  FEEDBACK_URL: z.preprocess((v) => (v === "" ? undefined : v), httpUrl.optional()),
});
export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid environment: ${variables.join(", ")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError([...new Set(result.error.issues.map((i) => String(i.path[0] ?? "?")))]);
  }
  return result.data;
}

export function getEnv(): Env {
  if (typeof window !== "undefined") throw new EnvError(["server-only"]);
  return parseEnv(process.env);
}

/**
 * Only the optional feedback link: public pages and the footer must render even when the API URL is missing
 * (the web tier starts and answers /api/healthz regardless). Invalid or empty means no link.
 */
export function getFeedbackUrl(): string | undefined {
  const parsed = EnvSchema.shape.FEEDBACK_URL.safeParse(process.env.FEEDBACK_URL);
  return parsed.success ? parsed.data : undefined;
}
