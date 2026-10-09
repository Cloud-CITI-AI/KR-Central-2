/**
 * Mock Microsoft Entra ID for tests (WP-07). Exposes the v2.0 endpoints the API uses
 * (`/{tenant}/v2.0/.well-known/openid-configuration`, authorize, token, JWKS, end-session) via `oidc-provider`,
 * issuing ID tokens with Entra-shaped claims (tid, oid, name, email, preferred_username, acct, amr).
 * Used by services/api integration tests and the apps/web Playwright harness. Never deployed.
 */
export interface MockUser {
  readonly oid: string;
  readonly name: string;
  readonly email: string | null;
  readonly preferredUsername: string;
  /** 0 = member, 1 = guest (Entra `acct` claim). */
  readonly acct: 0 | 1;
  readonly amr?: readonly string[];
}

export interface MockIdpOptions {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris?: readonly string[];
  readonly port?: number;
}

export interface MockIdp {
  /** Use as ENTRA_AUTHORITY_HOST (e.g. http://127.0.0.1:4010). */
  readonly authorityHost: string;
  readonly issuer: string;
  /** The next authorize request signs this user in without a login form. */
  setNextUser(user: MockUser): void;
  stop(): Promise<void>;
}
