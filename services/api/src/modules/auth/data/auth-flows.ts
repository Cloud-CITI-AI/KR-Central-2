/** Pending OIDC authorisation requests (`auth_flows`): created by startLogin, consumed exactly once by completeLogin. */
import { createHash } from "node:crypto";
import type { AuthFlowsTable, Db } from "@kr/db";
import type { Selectable } from "kysely";

export type AuthFlowRow = Selectable<AuthFlowsTable>;

/** Flows live for 10 minutes (PRODUCT_SPEC §3.1 step 2); the browser-binding cookie has the same Max-Age. */
export const AUTH_FLOW_TTL_SECONDS = 600;

export const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

export interface NewAuthFlow {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  /** Value of the `__Host-kr_auth` cookie handed to this browser; only its SHA-256 is stored. */
  readonly bindingValue: string;
  readonly now: Date;
}

export async function createAuthFlow(db: Db, flow: NewAuthFlow): Promise<void> {
  await db
    .insertInto("auth_flows")
    .values({
      state_hash: sha256(flow.state),
      nonce: flow.nonce,
      code_verifier: flow.codeVerifier,
      return_to: flow.returnTo,
      browser_binding_hash: sha256(flow.bindingValue),
      created_at: flow.now,
      expires_at: new Date(flow.now.getTime() + AUTH_FLOW_TTL_SECONDS * 1000),
    })
    .execute();
}

/**
 * Delete and return the flow for `state`, whoever presents it: a flow can never be replayed, and a callback that fails
 * the browser check still burns it. An expired flow is deleted and answers null.
 */
export async function consumeAuthFlow(db: Db, state: string, now: Date): Promise<AuthFlowRow | null> {
  const row = await db
    .deleteFrom("auth_flows")
    .where("state_hash", "=", sha256(state))
    .returningAll()
    .executeTakeFirst();
  return row && row.expires_at > now ? row : null;
}
