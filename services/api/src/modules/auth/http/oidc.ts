/**
 * The only place that talks to Entra ID, through openid-client v6 (SC-B4): cached discovery, authorize URL with PKCE
 * S256, and the code exchange, which verifies the ID token (signature via the tenant JWKS, iss, aud, nonce, exp) and
 * returns its claims. Every request has a timeout (BE-10).
 */
import * as client from "openid-client";
import type { ApiConfig } from "../../../config.js";
import { ServiceUnavailableError } from "../../../platform/errors.js";
import type { Clock } from "../../../platform/module.js";

/** Entra answers in well under a second; 5 s covers a cold token endpoint without hanging a sign-in. */
const TIMEOUT_SECONDS = 5;
/** Metadata and signing keys are re-discovered hourly, so a key roll-over never needs a restart. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export interface FlowSecrets {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface OidcClient {
  newFlowSecrets(): FlowSecrets;
  authorizationUrl(secrets: FlowSecrets): Promise<URL>;
  /** Redeem the callback (`callback` = redirect URI plus the query Entra sent); resolves to validated ID token claims. */
  exchange(callback: URL, secrets: FlowSecrets): Promise<Readonly<Record<string, unknown>>>;
}

type OidcConfig = Pick<
  ApiConfig,
  "APP_ENV" | "ENTRA_TENANT_ID" | "ENTRA_CLIENT_ID" | "ENTRA_CLIENT_SECRET" | "ENTRA_AUTHORITY_HOST" | "PUBLIC_BASE_URL"
>;

export function redirectUri(config: Pick<ApiConfig, "PUBLIC_BASE_URL">): string {
  return new URL("/api/v1/auth/callback", config.PUBLIC_BASE_URL).toString();
}

export function createOidcClient(config: OidcConfig, clock: Clock): OidcClient {
  const authority = new URL(`${config.ENTRA_AUTHORITY_HOST.replace(/\/+$/, "")}/${config.ENTRA_TENANT_ID}/v2.0`);
  // Plain HTTP is for the local mock IdP only; config refuses it (and any non-Microsoft host) in staging and production.
  const insecure = authority.protocol === "http:" && config.APP_ENV !== "staging" && config.APP_ENV !== "production";
  let cached: { readonly at: number; readonly configuration: Promise<client.Configuration> } | undefined;

  function configuration(): Promise<client.Configuration> {
    const now = clock.now().getTime();
    if (cached === undefined || now - cached.at > DISCOVERY_TTL_MS) {
      const fresh = client
        .discovery(authority, config.ENTRA_CLIENT_ID, config.ENTRA_CLIENT_SECRET, undefined, {
          timeout: TIMEOUT_SECONDS,
          ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
        })
        .catch((cause: unknown) => {
          cached = undefined;
          throw new ServiceUnavailableError({ detail: "The identity provider is not reachable.", cause });
        });
      cached = { at: now, configuration: fresh };
    }
    return cached.configuration;
  }

  return {
    newFlowSecrets: () => ({
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
    }),
    async authorizationUrl(secrets) {
      return client.buildAuthorizationUrl(await configuration(), {
        redirect_uri: redirectUri(config),
        scope: "openid profile email",
        response_type: "code",
        state: secrets.state,
        nonce: secrets.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(secrets.codeVerifier),
        code_challenge_method: "S256",
      });
    },
    async exchange(callback, secrets) {
      const tokens = await client.authorizationCodeGrant(await configuration(), callback, {
        pkceCodeVerifier: secrets.codeVerifier,
        expectedState: secrets.state,
        expectedNonce: secrets.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (claims === undefined) throw new TypeError("The token response carried no ID token.");
      return claims;
    },
  };
}
