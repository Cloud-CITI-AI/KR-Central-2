/**
 * Whether and how a new job gets a Teams channel (ADR-0015 A5). Pure: the route reads the settings, the cache and
 * the request and asks this what to do before the job is created.
 */
import { channelNameFor } from "@kr/workflow";
import type { TeamsSettingsRow } from "@kr/db";

/** The channel cache counts as fresh for this long (A5: "empty or older than one hour" creates the job anyway). */
export const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

export type ChannelPlan =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly name: string }
  | { readonly kind: "create"; readonly name: string }
  | { readonly kind: "create_unchecked"; readonly name: string };

export function planChannelForNewJob(input: {
  readonly flagOn: boolean;
  readonly settings: Pick<TeamsSettingsRow, "sync_enabled" | "create_channels_enabled" | "team_id">;
  readonly requested: boolean | undefined;
  readonly job: { jobNumber: string; address: string; clientName: string | null };
  readonly cache: { readonly cachedAt: Date | null; readonly nameTaken: (name: string) => boolean };
  readonly now: Date;
}): ChannelPlan {
  const s = input.settings;
  if (!input.flagOn || !s.sync_enabled || !s.create_channels_enabled || !s.team_id) return { kind: "none" };
  if (input.requested === false) return { kind: "none" };
  const name = channelNameFor(input.job);
  const fresh =
    input.cache.cachedAt !== null && input.now.getTime() - input.cache.cachedAt.getTime() <= CACHE_MAX_AGE_MS;
  if (!fresh) return { kind: "create_unchecked", name };
  if (input.cache.nameTaken(name)) return { kind: "refuse", name };
  return { kind: "create", name };
}
