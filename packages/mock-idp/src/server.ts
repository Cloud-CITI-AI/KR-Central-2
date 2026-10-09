import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import Provider, { type OidcContext } from "oidc-provider";
import type { MockIdp, MockIdpOptions, MockUser } from "./index.js";
import { logoutPage, signedOutPage, userPickerPage } from "./pages.js";

/** Entra's `sub` is pairwise per application; the mock derives one so nothing can mistake it for the `oid`. */
export function pairwiseSub(clientId: string, oid: string): string {
  return createHash("sha256").update(`${clientId}:${oid}`).digest("base64url");
}

/** Claims of an ID token as Entra v2.0 shapes them (absent optional claims stay absent). */
export function idTokenClaims(user: MockUser, tenantId: string, clientId: string): Record<string, unknown> {
  return {
    sub: pairwiseSub(clientId, user.oid),
    oid: user.oid,
    tid: user.tid ?? tenantId,
    name: user.name,
    preferred_username: user.preferredUsername,
    acct: user.acct,
    amr: [...(user.amr ?? ["pwd"])],
    ...(user.email === null ? {} : { email: user.email }),
    ...(user.acrs === undefined ? {} : { acrs: [...user.acrs] }),
    ...(user.xmsEdov === undefined ? {} : { xms_edov: user.xmsEdov }),
  };
}

const TTL = { Interaction: 600, Grant: 3600, Session: 3600, AccessToken: 300, IdToken: 300, AuthorizationCode: 60 };

type Payload = Record<string, unknown> & { grantId?: string; uid?: string; consumed?: number };

/** oidc-provider's storage contract on a Map: a mock holds nothing across restarts (and stays quiet in logs). */
class MemoryAdapter {
  readonly store: Map<string, Payload>;
  constructor(stores: Map<string, Map<string, Payload>>, name: string) {
    this.store = stores.get(name) ?? new Map<string, Payload>();
    stores.set(name, this.store);
  }
  upsert(id: string, payload: Payload): Promise<void> {
    this.store.set(id, payload);
    return Promise.resolve();
  }
  find(id: string): Promise<Payload | undefined> {
    return Promise.resolve(this.store.get(id));
  }
  findByUid(uid: string): Promise<Payload | undefined> {
    return Promise.resolve([...this.store.values()].find((p) => p.uid === uid));
  }
  findByUserCode(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  destroy(id: string): Promise<void> {
    this.store.delete(id);
    return Promise.resolve();
  }
  consume(id: string): Promise<void> {
    const found = this.store.get(id);
    if (found) found.consumed = Math.floor(Date.now() / 1000);
    return Promise.resolve();
  }
  revokeByGrantId(grantId: string): Promise<void> {
    for (const [id, p] of this.store) if (p.grantId === grantId) this.store.delete(id);
    return Promise.resolve();
  }
}

function signingKeys() {
  const jwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" });
  return { keys: [{ ...jwk, use: "sig", alg: "RS256", kid: randomBytes(8).toString("hex") }] };
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

export async function startMockIdp(opts: MockIdpOptions): Promise<MockIdp> {
  const stores = new Map<string, Map<string, Payload>>();
  const users = new Map(opts.users.map((u) => [u.oid, u]));
  const bySub = (sub: string) => [...users.values()].find((u) => pairwiseSub(opts.clientId, u.oid) === sub);
  let handler: (req: IncomingMessage, res: ServerResponse) => void = () => undefined;
  const server = createServer((req, res) => {
    handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  const authorityHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const issuer = opts.issuer ?? `${authorityHost}/${opts.tenantId}/v2.0`;
  const mount = new URL(issuer).pathname.replace(/\/$/, "");

  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uris: opts.redirectUris ?? ["https://mock-idp.invalid/callback"],
        post_logout_redirect_uris: opts.postLogoutRedirectUris ?? ["https://mock-idp.invalid/signed-out"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_post",
        id_token_signed_response_alg: "RS256",
        require_auth_time: true,
      },
    ],
    jwks: signingKeys(),
    // One store per mock instance: providers started side by side never share artifacts.
    adapter: class extends MemoryAdapter {
      constructor(name: string) {
        super(stores, name);
      }
    },
    ttl: TTL,
    cookies: { keys: [randomBytes(32).toString("hex")] },
    pkce: { required: () => true },
    // Entra puts name and email in the ID token even though an access token is issued with it.
    conformIdTokenClaims: false,
    routes: {
      authorization: "/oauth2/v2.0/authorize",
      token: "/oauth2/v2.0/token",
      jwks: "/discovery/v2.0/keys",
      end_session: "/oauth2/v2.0/logout",
    },
    claims: {
      acr: null,
      sid: null,
      auth_time: null,
      iss: null,
      openid: ["sub", "oid", "tid", "acct", "amr", "acrs", "xms_edov"],
      profile: ["name", "preferred_username"],
      email: ["email"],
    },
    findAccount: (_ctx: unknown, sub: string) => {
      const user = bySub(sub);
      return user && { accountId: sub, claims: () => idTokenClaims(user, opts.tenantId, opts.clientId) };
    },
    interactions: { url: (_ctx: unknown, it: { uid: string }) => `${mount}/interaction/${it.uid}` },
    // Microsoft does not ask first-party sign-ins for consent: grant what the client asked for.
    loadExistingGrant: async (ctx: OidcContext) => {
      const { oidc } = ctx;
      const known = oidc.result?.consent?.grantId ?? oidc.session.grantIdFor(oidc.client.clientId);
      if (known) return oidc.provider.Grant.find(known);
      const grant = new oidc.provider.Grant({ clientId: oidc.client.clientId, accountId: oidc.session.accountId });
      grant.addOIDCScope("openid profile email");
      await grant.save();
      return grant;
    },
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: {
        logoutSource: (ctx: OidcContext, form: string) => {
          ctx.body = logoutPage(form);
        },
        postLogoutSuccessSource: (ctx: OidcContext) => {
          ctx.body = signedOutPage();
        },
      },
    },
  });
  if (opts.redirectUris === undefined) provider.Client.prototype.redirectUriAllowed = () => true;
  if (opts.postLogoutRedirectUris === undefined) provider.Client.prototype.postLogoutRedirectUriAllowed = () => true;

  const finish = async (req: IncomingMessage, res: ServerResponse, result: Record<string, unknown>) => {
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  };
  const signInAs = (req: IncomingMessage, res: ServerResponse, user: MockUser) =>
    finish(req, res, {
      login: { accountId: pairwiseSub(opts.clientId, user.oid), amr: user.amr ?? ["pwd"], remember: false },
    });
  const denied = (req: IncomingMessage, res: ServerResponse) =>
    finish(req, res, { error: "access_denied", error_description: "The user cancelled the sign-in." });

  /** `/interaction/<uid>` signs in the `login_hint` user (or shows the picker); `/pick?oid=` and `/cancel` for people. */
  const interaction = async (req: IncomingMessage, res: ServerResponse, rest: string): Promise<void> => {
    const [uid, action] = rest.split("?")[0]?.split("/").filter(Boolean) ?? [];
    const details = await provider.interactionDetails(req, res);
    if (uid !== details.uid) {
      send(res, 404, "unknown interaction");
    } else if (action === "cancel") {
      await denied(req, res);
    } else if (action === "pick") {
      const user = users.get(new URL(rest, "http://x").searchParams.get("oid") ?? "");
      if (user) await signInAs(req, res, user);
      else send(res, 404, "unknown user");
    } else {
      const hint = details.params.login_hint?.toLowerCase();
      const user = [...users.values()].find(
        (u) => u.email?.toLowerCase() === hint || u.preferredUsername.toLowerCase() === hint || u.oid === hint,
      );
      if (hint === undefined) send(res, 200, userPickerPage(`${mount}/interaction/${uid}`, [...users.values()]));
      else if (user) await signInAs(req, res, user);
      else await denied(req, res);
    }
  };

  const oidc = provider.callback();
  handler = (req, res) => {
    const url = req.url ?? "/";
    const rest = url.slice(mount.length);
    if (!url.startsWith(`${mount}/`)) {
      send(res, 404, "not found");
    } else if (rest.startsWith("/interaction/")) {
      interaction(req, res, rest.slice("/interaction/".length)).catch(() => {
        send(res, 400, "interaction failed");
      });
    } else {
      // oidc-provider builds its absolute URLs from originalUrl, so keep the full path there (as Express mounting does).
      (req as IncomingMessage & { originalUrl?: string }).originalUrl = url;
      req.url = rest;
      oidc(req, res);
    }
  };

  return {
    authorityHost,
    issuer,
    addUser: (user) => {
      users.set(user.oid, user);
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
