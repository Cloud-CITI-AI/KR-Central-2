/**
 * Mock Microsoft Entra ID for tests and local development (WP-07). Serves the v2.0 OIDC endpoints the API uses
 * (discovery, authorize, token, JWKS) through `oidc-provider`, issuing ID tokens with Entra-shaped claims (oid, tid,
 * name, email, preferred_username, acct, amr, acrs, xms_edov). Authorize signs in the user named by `login_hint`
 * without a form, so Playwright can drive it. Never deployed: staging and production pin the real authority.
 */
export { startMockIdp } from "./server.js";
export { followAuthorize } from "./browser.js";

export interface MockUser {
  /** Entra object id: with `tid` the identity key. */
  readonly oid: string;
  readonly name: string;
  /** `email` claim; omitted from the token when null. */
  readonly email: string | null;
  /** UPN-style `preferred_username`. */
  readonly preferredUsername: string;
  /** 0 = tenant member, 1 = B2B guest (Entra `acct` claim). */
  readonly acct: 0 | 1;
  /** Overrides the `tid` claim (a token from another tenant). */
  readonly tid?: string;
  /** Default `["pwd"]`; add "mfa" to prove MFA. */
  readonly amr?: readonly string[];
  /** Conditional Access contexts (`acrs` claim); omitted when undefined. */
  readonly acrs?: readonly string[];
  /** `xms_edov` (email domain verified); omitted when undefined. */
  readonly xmsEdov?: boolean;
}

export interface MockIdpOptions {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly users: readonly MockUser[];
  /** Listen port (default 0 = any free port). */
  readonly port?: number;
  /** Listen address (default 127.0.0.1; a container needs 0.0.0.0 to be reachable). */
  readonly host?: string;
  /**
   * The URL browsers and the API use to reach the mock, when that is not `http://127.0.0.1:<port>` (a compose hostname).
   * It becomes `authorityHost` and the base of the default issuer; both sides must use the same one.
   */
  readonly publicUrl?: string;
  /** Issuer URL; default `${authorityHost}/${tenantId}/v2.0` (the shape of Entra's). */
  readonly issuer?: string;
  /** Allowed redirect URIs; when omitted every redirect URI is accepted (mock only). */
  readonly redirectUris?: readonly string[];
  /** Allowed post-logout redirect URIs; when omitted every one is accepted. */
  readonly postLogoutRedirectUris?: readonly string[];
}

export interface MockIdp {
  /** Use as ENTRA_AUTHORITY_HOST (e.g. http://127.0.0.1:4010). */
  readonly authorityHost: string;
  readonly issuer: string;
  /** Add or replace (by oid) a user. */
  addUser(user: MockUser): void;
  stop(): Promise<void>;
}
