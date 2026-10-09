/** What the session hook attaches to an authenticated request (ADR-0002). Handlers read it through the route context. */
import type { GlobalCapability, GlobalRole } from "@kr/contracts";

export interface AuthUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly role: GlobalRole;
  readonly isGuest: boolean;
}

export interface AuthSession {
  /** SHA-256 of the cookie value (sessions.id_hash). */
  readonly idHash: Buffer;
  readonly csrfToken: string;
  readonly authTime: Date;
  readonly amr: readonly string[];
  readonly acrs: readonly string[];
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface AuthContext {
  readonly user: AuthUser;
  readonly session: AuthSession;
  readonly globalCapabilities: readonly GlobalCapability[];
  /** Set by the authz helpers; defineRoute fails closed when a session route finishes without any authz check. */
  authzChecked: boolean;
}

/** Record that the handler performed an explicit authorisation decision (BE-5). */
export function markAuthzChecked(auth: AuthContext): void {
  auth.authzChecked = true;
}

declare module "fastify" {
  interface FastifyRequest {
    /** null until the session hook authenticates the request (always null on public routes). */
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    operationId?: string;
  }
}
