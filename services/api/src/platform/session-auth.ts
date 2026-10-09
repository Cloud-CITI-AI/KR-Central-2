/**
 * Authentication hook: every request is authenticated before routing-specific code runs. Only operations the contract
 * marks `auth: "public"` skip it; everything else (including unknown paths) answers 401 without a valid session.
 */
import { ROUTES, globalCapabilitiesFor, toFastifyPath } from "@kr/contracts";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthContext } from "./auth-context.js";
import { UnauthenticatedError } from "./errors.js";
import type { ModuleDeps } from "./module.js";
import { SESSION_COOKIE, hashSessionId, isWellFormedSessionCookie, minutesFrom, sessionPolicy } from "./session.js";

/** last_seen_at is written at most once a minute (one write per active user minute, not per request). */
export const LAST_SEEN_RESOLUTION_MS = 60_000;

const PUBLIC_ROUTES = new Set(
  ROUTES.filter((r) => r.auth === "public").map((r) => `${r.method} ${toFastifyPath(r.path)}`),
);

export function isPublicRoute(request: Pick<FastifyRequest, "method" | "routeOptions">): boolean {
  const method = request.method === "HEAD" ? "GET" : request.method;
  return PUBLIC_ROUTES.has(`${method} ${request.routeOptions.url ?? ""}`);
}

export async function registerSessionAuth(
  app: FastifyInstance,
  deps: Pick<ModuleDeps, "db" | "clock" | "config" | "log">,
): Promise<void> {
  await app.register(fastifyCookie);
  const policy = sessionPolicy(deps);

  app.addHook("onRequest", async (request) => {
    if (isPublicRoute(request)) return;
    const cookie = request.cookies[SESSION_COOKIE];
    if (!isWellFormedSessionCookie(cookie)) throw new UnauthenticatedError();
    const idHash = hashSessionId(cookie);
    const row = await deps.db
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .select([
        "sessions.csrf_token",
        "sessions.auth_time",
        "sessions.amr",
        "sessions.acrs",
        "sessions.last_seen_at",
        "sessions.idle_expires_at",
        "sessions.absolute_expires_at",
        "sessions.revoked_at",
        "users.id as user_id",
        "users.display_name",
        "users.email",
        "users.role",
        "users.is_guest",
        "users.status",
      ])
      .where("sessions.id_hash", "=", idHash)
      .executeTakeFirst();
    const now = deps.clock.now();
    if (row === undefined) throw new UnauthenticatedError();
    const expired = row.idle_expires_at <= now || row.absolute_expires_at <= now;
    if (row.revoked_at !== null || row.status !== "active" || expired) throw new UnauthenticatedError();

    let idleExpiresAt = row.idle_expires_at;
    if (now.getTime() - row.last_seen_at.getTime() >= LAST_SEEN_RESOLUTION_MS) {
      idleExpiresAt = new Date(
        Math.min(minutesFrom(now, policy.idleMinutes).getTime(), row.absolute_expires_at.getTime()),
      );
      await deps.db
        .updateTable("sessions")
        .set({ last_seen_at: now, idle_expires_at: idleExpiresAt })
        .where("id_hash", "=", idHash)
        .where("revoked_at", "is", null)
        .execute();
    }

    const auth: AuthContext = {
      user: { id: row.user_id, displayName: row.display_name, email: row.email, role: row.role, isGuest: row.is_guest },
      session: {
        idHash,
        csrfToken: row.csrf_token,
        authTime: row.auth_time,
        amr: row.amr,
        acrs: row.acrs,
        idleExpiresAt,
        absoluteExpiresAt: row.absolute_expires_at,
      },
      globalCapabilities: globalCapabilitiesFor(row.role),
      authzChecked: false,
    };
    request.auth = auth;
  });
}
