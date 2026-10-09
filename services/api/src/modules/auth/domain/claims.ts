/**
 * The identity in an ID token that openid-client has already validated (signature, iss, aud, nonce, exp). This reads
 * the Entra claims the app registration emits (PRODUCT_SPEC §3.1 step 4) and applies the one check the library cannot:
 * the token's `tid` is the configured tenant. Nothing here parses or verifies a JWT (SC-B4).
 */
import { z } from "zod";
import { selectEmail } from "./email.js";
import type { SignInReason } from "./reasons.js";

export const DISPLAY_NAME_MAX_LENGTH = 200;
const LIST_MAX = 20;
const ITEM_MAX = 64;

export interface Identity {
  readonly tid: string;
  readonly oid: string;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly email: string | null;
  /** False only when the token says `xms_edov=false`: the email's domain is not verified. */
  readonly emailVerified: boolean;
  /** `auth_time` when the IdP sent it. */
  readonly authTime: Date | null;
  readonly amr: readonly string[];
  readonly acrs: readonly string[];
}

const text = z.string().optional().catch(undefined);
const list = z
  .array(z.string().max(ITEM_MAX))
  .transform((v) => v.slice(0, LIST_MAX))
  .catch([]);
/** Entra documents `xms_edov` as a boolean; be strict about what counts as "not verified", lenient about its encoding. */
const notVerified = z.union([z.literal(false), z.literal("false"), z.literal("0"), z.literal(0)]);

const Claims = z.object({
  tid: z.guid(),
  oid: z.guid(),
  acct: z.union([z.literal(0), z.literal(1), z.literal("0"), z.literal("1")]),
  name: text,
  email: text,
  preferred_username: text,
  xms_edov: z.unknown().optional(),
  auth_time: z.number().positive().optional().catch(undefined),
  amr: list.optional(),
  acrs: list.optional(),
});

export type IdentityResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: Extract<SignInReason, "failed" | "wrong_tenant"> };

export function readIdentity(claims: Readonly<Record<string, unknown>>, expectedTenantId: string): IdentityResult {
  const parsed = Claims.safeParse(claims);
  // An unreadable tid/oid/acct is a failed sign-in: unknown account type must not be treated as "member".
  if (!parsed.success) return { ok: false, reason: "failed" };
  const c = parsed.data;
  if (c.tid.toLowerCase() !== expectedTenantId.toLowerCase()) return { ok: false, reason: "wrong_tenant" };
  const isGuest = Number(c.acct) === 1;
  const email = selectEmail({ isGuest, email: c.email, preferredUsername: c.preferred_username });
  const name = [c.name, email, c.preferred_username].map((v) => v?.trim()).find(Boolean) ?? "Unknown user";
  return {
    ok: true,
    identity: {
      tid: c.tid.toLowerCase(),
      oid: c.oid.toLowerCase(),
      displayName: name.slice(0, DISPLAY_NAME_MAX_LENGTH),
      isGuest,
      email,
      emailVerified: !notVerified.safeParse(c.xms_edov).success,
      authTime: c.auth_time === undefined ? null : new Date(c.auth_time * 1000),
      amr: c.amr ?? [],
      acrs: c.acrs ?? [],
    },
  };
}
