/**
 * Microsoft Graph adapter for GuestInviter: `POST /v1.0/invitations` with an application (client-credentials) token for
 * the same app registration (permission User.Invite.All, ADR-0014). One 10 s deadline covers the token request and the
 * invitation together. No retries: an invitation is not idempotent, and staff can see the failure and add the person
 * again. The token is cached until a minute before it expires. Secrets, tokens and response bodies never reach the
 * error text; only the HTTP status and Graph's error code do.
 */
import type { ApiConfig } from "../../../config.js";
import type { Clock } from "../../../platform/module.js";
import { InvitationError, type GuestInvitation, type GuestInviter } from "../domain/guest-inviter.js";

export const GRAPH_BASE_URL = "https://graph.microsoft.com";
export const GRAPH_TIMEOUT_MS = 10_000;

export interface GraphInviterOptions {
  readonly config: Pick<
    ApiConfig,
    "ENTRA_TENANT_ID" | "ENTRA_CLIENT_ID" | "ENTRA_CLIENT_SECRET" | "ENTRA_AUTHORITY_HOST"
  >;
  readonly clock: Clock;
  /** Tests point this at a local server; production uses Microsoft's host. */
  readonly graphBaseUrl?: string;
  readonly timeoutMs?: number;
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    const e = body.error;
    const code = typeof e === "string" ? e : (e as { code?: unknown } | undefined)?.code;
    return typeof code === "string" && /^[\w.-]{1,80}$/.test(code) ? ` (${code})` : "";
  } catch {
    return "";
  }
}

export function createGraphInviter(o: GraphInviterOptions): GuestInviter {
  const graph = (o.graphBaseUrl ?? GRAPH_BASE_URL).replace(/\/+$/, "");
  const authority = o.config.ENTRA_AUTHORITY_HOST.replace(/\/+$/, "");
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(signal: AbortSignal): Promise<string> {
    if (cached && cached.expiresAt > o.clock.now().getTime()) return cached.token;
    const res = await fetch(`${authority}/${o.config.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: o.config.ENTRA_CLIENT_ID,
        client_secret: o.config.ENTRA_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal,
    });
    if (!res.ok)
      throw new InvitationError(
        `Microsoft sign-in for the invitation failed with ${res.status}${await errorCode(res)}.`,
      );
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") throw new InvitationError("Microsoft returned no access token.");
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 300;
    cached = { token: body.access_token, expiresAt: o.clock.now().getTime() + Math.max(0, seconds - 60) * 1000 };
    return body.access_token;
  }

  return {
    async invite(invitation: GuestInvitation): Promise<void> {
      const signal = AbortSignal.timeout(o.timeoutMs ?? GRAPH_TIMEOUT_MS);
      try {
        const token = await accessToken(signal);
        const res = await fetch(`${graph}/v1.0/invitations`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            invitedUserEmailAddress: invitation.email,
            ...(invitation.displayName ? { invitedUserDisplayName: invitation.displayName } : {}),
            inviteRedirectUrl: invitation.redirectUrl,
            sendInvitationMessage: true,
          }),
          signal,
        });
        if (res.status === 401) cached = null;
        if (!res.ok)
          throw new InvitationError(
            `Microsoft Graph refused the invitation with ${res.status}${await errorCode(res)}.`,
          );
      } catch (error) {
        if (error instanceof InvitationError) throw error;
        if (signal.aborted) throw new InvitationError("Microsoft Graph did not answer in time.", { cause: error });
        throw new InvitationError("Microsoft Graph could not be reached.", { cause: error });
      }
    },
  };
}
