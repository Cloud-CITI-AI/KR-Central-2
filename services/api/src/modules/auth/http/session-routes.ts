/** The signed-in user's own session: `logout` (PRODUCT_SPEC §3.1 sign-out) and `getMe` (the shell's bootstrap call). */
import type { Me } from "@kr/contracts";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../../../platform/authz.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { clearSessionCookie, revokeSession } from "../../../platform/session.js";
import { findSessionUserProfile } from "../data/users.js";
import type { OidcClient } from "./oidc.js";

export function registerSessionRoutes(app: FastifyInstance, deps: ModuleDeps, oidc: OidcClient): void {
  const signedOut = new URL("/signed-out", deps.config.PUBLIC_BASE_URL).toString();

  defineRoute(app, "logout", async ({ auth, request, reply }) => {
    requireSignedIn(auth);
    await revokeSession(deps.db, auth.session.idHash, "logout", deps.clock);
    clearSessionCookie(reply);
    request.log.info({ event: "authn_logout", userId: auth.user.id }, "Signed out");
    // Signing out must not depend on Entra being reachable: without its end-session URL the browser still lands on /signed-out.
    const redirectTo = await oidc.endSessionUrl(signedOut).then(
      (url) => url.toString(),
      (err: unknown) => {
        request.log.warn({
          event: "authn_end_session_unavailable",
          errName: err instanceof Error ? err.name : typeof err,
        });
        return signedOut;
      },
    );
    return { redirectTo };
  });

  defineRoute(app, "getMe", async ({ auth }): Promise<Me> => {
    requireSignedIn(auth);
    const user = await findSessionUserProfile(deps.db, auth.user.id);
    const { session } = auth;
    return {
      user: {
        id: auth.user.id,
        displayName: auth.user.displayName,
        email: auth.user.email,
        role: auth.user.role,
        isGuest: auth.user.isGuest,
        status: user.status,
        lastSignInAt: user.last_sign_in_at?.toISOString() ?? null,
        createdAt: user.created_at.toISOString(),
      },
      capabilities: [...auth.globalCapabilities],
      csrfToken: session.csrfToken,
      features: {
        aiStampReading: deps.flags.isEnabled("ai-stamp-reading"),
        guestInvites: deps.flags.isEnabled("entra-guest-invites"),
        malwareScanning: deps.config.MALWARE_SCAN_MODE === "required",
      },
      uploadMaxBytes: deps.config.UPLOAD_MAX_BYTES,
      // The earliest the session can end if nothing happens: the sliding idle limit or the absolute one.
      sessionExpiresAt: new Date(
        Math.min(session.idleExpiresAt.getTime(), session.absoluteExpiresAt.getTime()),
      ).toISOString(),
    };
  });
}
