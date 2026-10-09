import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { followAuthorize, startMockIdp, type MockIdp, type MockUser } from "./index.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SECRET = "mock-idp-test-secret";
const REDIRECT = "https://tracker.test/api/v1/auth/callback";

const member: MockUser = {
  oid: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Mia Member",
  email: "mia@staff.test",
  preferredUsername: "mia@staff.test",
  acct: 0,
  amr: ["pwd", "mfa"],
  acrs: ["c1"],
};
const guest: MockUser = {
  oid: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Gus Guest",
  email: null,
  preferredUsername: "gus_client.test#EXT#@staff.test",
  acct: 1,
  xmsEdov: false,
  tid: "99999999-9999-4999-8999-999999999999",
};

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
const b64json = (part: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as Record<string, unknown>;

describe("mock Entra IdP", () => {
  let idp: MockIdp;
  let meta: Discovery;
  beforeAll(async () => {
    idp = await startMockIdp({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, users: [member] });
    meta = (await (await fetch(`${idp.issuer}/.well-known/openid-configuration`)).json()) as Discovery;
  });
  afterAll(() => idp.stop());

  const authorizeUrl = (verifier: string, nonce = "n-1") => {
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: CLIENT,
      response_type: "code",
      redirect_uri: REDIRECT,
      scope: "openid profile email",
      state: "st-1",
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  };
  const exchange = (code: string, verifier: string, secret = SECRET) =>
    fetch(meta.token_endpoint, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT,
        client_secret: secret,
        code_verifier: verifier,
      }),
    });

  it("publishes Entra-shaped discovery under /{tenant}/v2.0", () => {
    expect(idp.issuer).toBe(`${idp.authorityHost}/${TENANT}/v2.0`);
    expect(meta).toMatchObject({ issuer: idp.issuer, token_endpoint: `${idp.issuer}/oauth2/v2.0/token` });
    expect(meta.jwks_uri).toBe(`${idp.issuer}/discovery/v2.0/keys`);
  });

  it("signs in the login_hint user and issues a signed ID token with the Entra claims", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const callback = await followAuthorize(idp, authorizeUrl(verifier), "MIA@staff.test");
    expect(callback.origin + callback.pathname).toBe(REDIRECT);
    expect(callback.searchParams.get("state")).toBe("st-1");

    const res = await exchange(callback.searchParams.get("code") ?? "", verifier);
    expect(res.status).toBe(200);
    const { id_token: idToken } = (await res.json()) as { id_token: string };
    const [header, payload, signature] = idToken.split(".");
    const jwks = (await (await fetch(meta.jwks_uri)).json()) as { keys: { kid: string }[] };
    const key = createPublicKey({ key: jwks.keys[0] as never, format: "jwk" });
    expect(
      verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), key, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
    expect(b64json(header)).toMatchObject({ alg: "RS256", kid: jwks.keys[0]?.kid });
    const claims = b64json(payload);
    expect(claims).toMatchObject({
      iss: idp.issuer,
      aud: CLIENT,
      nonce: "n-1",
      oid: member.oid,
      tid: TENANT,
      name: "Mia Member",
      email: "mia@staff.test",
      preferred_username: "mia@staff.test",
      acct: 0,
      amr: ["pwd", "mfa"],
      acrs: ["c1"],
    });
    expect(claims.sub).not.toBe(member.oid);
    expect(claims).not.toHaveProperty("xms_edov");
    expect(typeof claims.auth_time).toBe("number");
  });

  it("emits per-user quirks: no email claim, xms_edov=false, a foreign tid, default amr pwd", async () => {
    idp.addUser(guest);
    const verifier = randomBytes(32).toString("base64url");
    const callback = await followAuthorize(idp, authorizeUrl(verifier), guest.oid);
    const res = await exchange(callback.searchParams.get("code") ?? "", verifier);
    const claims = b64json(((await res.json()) as { id_token: string }).id_token.split(".")[1]);
    expect(claims).toMatchObject({ acct: 1, xms_edov: false, tid: guest.tid, amr: ["pwd"] });
    expect(claims).not.toHaveProperty("email");
    expect(claims).not.toHaveProperty("acrs");
  });

  it("answers access_denied (a cancelled sign-in) for an unknown hint and keeps the state", async () => {
    const callback = await followAuthorize(idp, authorizeUrl("v".repeat(43)), "nobody@staff.test");
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe("st-1");
    expect(callback.searchParams.has("code")).toBe(false);
  });
});
