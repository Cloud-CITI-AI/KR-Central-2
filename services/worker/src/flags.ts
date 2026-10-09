/**
 * Feature flags through OpenFeature (CF-4, docs/flags.md, ADR-0013): the worker reads `ai-stamp-reading` here and never
 * from FEATURE_* configuration directly. Values come from configuration, held by an in-memory provider under the
 * "kr-worker" domain and resolved once at startup, so `isEnabled` stays synchronous for handlers.
 */
import { OpenFeature, TypedInMemoryProvider } from "@openfeature/server-sdk";
import type { WorkerConfig } from "./config.js";

export type FeatureFlag = "ai-stamp-reading";

export const FLAG_KEYS: readonly FeatureFlag[] = ["ai-stamp-reading"];

export interface FeatureFlags {
  isEnabled(flag: FeatureFlag): boolean;
}

const DOMAIN = "kr-worker";

/** Resolve every flag through OpenFeature once and expose the result synchronously. */
export async function createFeatureFlags(
  config: Pick<WorkerConfig, "FEATURE_AI_STAMP_READING">,
): Promise<FeatureFlags> {
  const on = config.FEATURE_AI_STAMP_READING;
  const provider = new TypedInMemoryProvider({
    "ai-stamp-reading": {
      variants: { on: true, off: false },
      defaultVariant: on ? ("on" as const) : ("off" as const),
      disabled: false,
    },
  });
  await OpenFeature.setProviderAndWait(DOMAIN, provider);
  const client = OpenFeature.getClient(DOMAIN);
  const resolved = new Map<FeatureFlag, boolean>();
  for (const key of FLAG_KEYS) resolved.set(key, await client.getBooleanValue(key, false));
  return { isEnabled: (flag) => resolved.get(flag) ?? false };
}

/** Test double: fixed flag values (unspecified flags are off). */
export function staticFlags(values: Partial<Record<FeatureFlag, boolean>> = {}): FeatureFlags {
  return { isEnabled: (flag) => values[flag] ?? false };
}
