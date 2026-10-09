/**
 * The browser-binding cookie `__Host-kr_auth` (login-CSRF defence, ADR-0002): startLogin hands this browser a random
 * 256-bit value and stores its SHA-256 in the flow; completeLogin only proceeds when the same browser presents it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import { AUTH_FLOW_TTL_SECONDS, sha256 } from "../data/auth-flows.js";

export const BINDING_COOKIE = "__Host-kr_auth";
const OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
/** 32 bytes as base64url. */
const FORMAT = /^[A-Za-z0-9_-]{43}$/;

export const newBindingValue = (): string => randomBytes(32).toString("base64url");

export function setBindingCookie(reply: FastifyReply, value: string): void {
  void reply.setCookie(BINDING_COOKIE, value, { ...OPTIONS, maxAge: AUTH_FLOW_TTL_SECONDS });
}

export function clearBindingCookie(reply: FastifyReply): void {
  void reply.clearCookie(BINDING_COOKIE, OPTIONS);
}

/** True only when `presented` is a well-formed cookie value whose SHA-256 equals the flow's stored hash. */
export function matchesBinding(presented: string | undefined, storedHash: Buffer): boolean {
  return presented !== undefined && FORMAT.test(presented) && timingSafeEqual(sha256(presented), storedHash);
}
