/**
 * Server-side sessions (ADR-0002). The cookie holds 256 random bits; only their SHA-256 is stored (`sessions.id_hash`),
 * so a database read cannot be replayed as a cookie. Sign-in (WP-07) calls createSession; the hook in session-auth.ts
 * resolves it on every request.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Database, Db } from "@kr/db";
import "@fastify/cookie";
import type { FastifyReply } from "fastify";
import type { Kysely, Transaction } from "kysely";
import type { ApiConfig } from "../config.js";
import type { Clock } from "./module.js";

export const SESSION_COOKIE = "__Host-kr_session";
/** 32 bytes as base64url. */
const COOKIE_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const USER_AGENT_MAX = 256;

type Executor = Db | Transaction<Database> | Kysely<Database>;

export interface SessionPolicy {
  readonly clock: Clock;
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}

export function sessionPolicy(deps: {
  clock: Clock;
  config: Pick<ApiConfig, "SESSION_IDLE_MINUTES" | "SESSION_ABSOLUTE_HOURS">;
}): SessionPolicy {
  return {
    clock: deps.clock,
    idleMinutes: deps.config.SESSION_IDLE_MINUTES,
    absoluteHours: deps.config.SESSION_ABSOLUTE_HOURS,
  };
}

export interface NewSession {
  readonly userId: string;
  /** When the user authenticated at the IdP (`auth_time`). */
  readonly authTime: Date;
  readonly amr: readonly string[];
  readonly acrs: readonly string[];
  readonly userAgent?: string | null;
}

export interface CreatedSession {
  /** Value for the `__Host-kr_session` cookie. Never stored or logged. */
  readonly cookieValue: string;
  readonly csrfToken: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export function hashSessionId(cookieValue: string): Buffer {
  return createHash("sha256").update(cookieValue).digest();
}

/** A cookie value that is worth a database lookup (right length and alphabet). */
export function isWellFormedSessionCookie(value: unknown): value is string {
  return typeof value === "string" && COOKIE_FORMAT.test(value);
}

export function minutesFrom(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/** New session with a fresh id and CSRF token. Callers rotate on every sign-in (never reuse an id). */
export async function createSession(db: Executor, input: NewSession, policy: SessionPolicy): Promise<CreatedSession> {
  const now = policy.clock.now();
  const cookieValue = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const absoluteExpiresAt = minutesFrom(now, policy.absoluteHours * 60);
  const idleExpiresAt = new Date(Math.min(minutesFrom(now, policy.idleMinutes).getTime(), absoluteExpiresAt.getTime()));
  await db
    .insertInto("sessions")
    .values({
      id_hash: hashSessionId(cookieValue),
      user_id: input.userId,
      csrf_token: csrfToken,
      auth_time: input.authTime,
      amr: [...input.amr],
      acrs: [...input.acrs],
      user_agent: input.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      created_at: now,
      last_seen_at: now,
      idle_expires_at: idleExpiresAt,
      absolute_expires_at: absoluteExpiresAt,
    })
    .execute();
  return { cookieValue, csrfToken, idleExpiresAt, absoluteExpiresAt };
}

export type RevokeReason = "logout" | "role_changed" | "user_disabled" | "rotated" | "admin";

/** Revoke one session (by cookie hash). Idempotent. */
export async function revokeSession(db: Executor, idHash: Buffer, reason: RevokeReason, clock: Clock): Promise<void> {
  await db
    .updateTable("sessions")
    .set({ revoked_at: clock.now(), revoked_reason: reason })
    .where("id_hash", "=", idHash)
    .where("revoked_at", "is", null)
    .execute();
}

/** Revoke every live session of a user (role change, disable); `except` keeps the caller's own session. */
export async function revokeAllForUser(
  db: Executor,
  userId: string,
  reason: RevokeReason,
  clock: Clock,
  except?: Buffer,
): Promise<number> {
  let q = db
    .updateTable("sessions")
    .set({ revoked_at: clock.now(), revoked_reason: reason })
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null);
  if (except) q = q.where("id_hash", "<>", except);
  const res = await q.executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** `__Host-` cookies must be Secure, Path=/ and carry no Domain. A session cookie: it ends with the browser session. */
export function setSessionCookie(reply: FastifyReply, cookieValue: string): void {
  void reply.setCookie(SESSION_COOKIE, cookieValue, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}
