/**
 * Feature flags through OpenFeature (CF-4, docs/flags.md) plus the injected clocks (TD-4).
 * Values come from FEATURE_* configuration, held by an in-memory provider under the "kr-api" domain; evaluations are
 * resolved once at startup so FeatureFlags.isEnabled stays synchronous for handlers.
 */
import { OpenFeature, TypedInMemoryProvider } from "@openfeature/server-sdk";
import type { ApiConfig } from "../config.js";
import type { Clock, FeatureFlag, FeatureFlags } from "./module.js";

export const FLAG_KEYS: readonly FeatureFlag[] = ["ai-stamp-reading", "entra-guest-invites"];

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock & { set(next: Date | string): void; advance(ms: number): void } {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

const DOMAIN = "kr-api";

function flagConfiguration(values: Readonly<Record<FeatureFlag, boolean>>) {
  const entry = (on: boolean) => ({
    variants: { on: true, off: false },
    defaultVariant: on ? ("on" as const) : ("off" as const),
    disabled: false,
  });
  return {
    "ai-stamp-reading": entry(values["ai-stamp-reading"]),
    "entra-guest-invites": entry(values["entra-guest-invites"]),
  };
}

/** Resolve every flag through OpenFeature once and expose the result synchronously. */
export async function createFeatureFlags(
  config: Pick<ApiConfig, "FEATURE_AI_STAMP_READING" | "FEATURE_ENTRA_GUEST_INVITES">,
): Promise<FeatureFlags> {
  const provider = new TypedInMemoryProvider(
    flagConfiguration({
      "ai-stamp-reading": config.FEATURE_AI_STAMP_READING,
      "entra-guest-invites": config.FEATURE_ENTRA_GUEST_INVITES,
    }),
  );
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
