import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../../../platform/flags.js";
import { testConfig } from "../../../../test/helpers/index.js";
import { InvitationError } from "../domain/guest-inviter.js";
import { createGraphInviter } from "./graph-inviter.js";

interface Seen {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
}

/** One local server plays both the Entra token endpoint and Microsoft Graph. No real Microsoft host is ever called. */
describe("Graph guest inviter (local fake of Entra and Graph)", () => {
  let server: Server;
  let base: string;
  let seen: Seen[];
  let respond: (req: IncomingMessage, url: string) => { status: number; body: unknown } | "hang";
  const ok = { status: 200, body: { access_token: "tok-1", expires_in: 3600 } };
  const clock = fixedClock("2026-03-02T01:00:00Z");
  const make = (timeoutMs?: number) =>
    createGraphInviter({
      config: testConfig({ ENTRA_AUTHORITY_HOST: base }),
      clock,
      graphBaseUrl: base,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  const invitation = { email: "guest@example.test", displayName: "Gwen Guest", redirectUrl: "https://tracker.test" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        });
        const out = respond(req, req.url ?? "");
        if (out === "hang") return;
        res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });
  beforeEach(() => {
    seen = [];
    respond = (_req, url) =>
      url.endsWith("/token")
        ? ok
        : { status: 201, body: { id: "inv-1", inviteRedeemUrl: "https://secret.invalid/redeem" } };
  });

  it("gets a client-credentials token and posts the invitation to /v1.0/invitations", async () => {
    await make().invite(invitation);
    const [token, invite] = seen;
    expect(token).toMatchObject({ method: "POST", url: `/${testConfig().ENTRA_TENANT_ID}/oauth2/v2.0/token` });
    const form = new URLSearchParams(token?.body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: testConfig().ENTRA_CLIENT_ID,
      client_secret: testConfig().ENTRA_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    expect(invite).toMatchObject({ method: "POST", url: "/v1.0/invitations", authorization: "Bearer tok-1" });
    expect(JSON.parse(invite?.body ?? "")).toEqual({
      invitedUserEmailAddress: "guest@example.test",
      invitedUserDisplayName: "Gwen Guest",
      inviteRedirectUrl: "https://tracker.test",
      sendInvitationMessage: true,
    });
  });

  it("reuses the token until a minute before it expires", async () => {
    const inviter = make();
    await inviter.invite({ ...invitation, displayName: null });
    await inviter.invite(invitation);
    expect(seen.filter((s) => s.url?.endsWith("/token"))).toHaveLength(1);
    clock.advance(3600_000);
    await inviter.invite(invitation);
    expect(seen.filter((s) => s.url?.endsWith("/token"))).toHaveLength(2);
    expect(JSON.parse(seen[1]?.body ?? "")).not.toHaveProperty("invitedUserDisplayName");
  });

  it("reports Graph's status and error code but never its body, a token or the secret", async () => {
    respond = (_req, url) =>
      url.endsWith("/token")
        ? ok
        : { status: 403, body: { error: { code: "Authorization_RequestDenied", message: "tok-1 secret" } } };
    const error = await make()
      .invite(invitation)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvitationError);
    expect((error as Error).message).toBe(
      "Microsoft Graph refused the invitation with 403 (Authorization_RequestDenied).",
    );
    expect((error as Error).message).not.toMatch(/tok-1|secret/);
  });

  it("fails clearly when the token request is refused", async () => {
    respond = () => ({ status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215 secret" } });
    await expect(make().invite(invitation)).rejects.toThrow(
      "Microsoft sign-in for the invitation failed with 401 (invalid_client).",
    );
    expect(seen).toHaveLength(1);
  });

  it("gives up after the timeout and when the host cannot be reached", async () => {
    respond = () => "hang";
    await expect(make(150).invite(invitation)).rejects.toThrow("did not answer in time");
    const unreachable = createGraphInviter({
      config: testConfig({ ENTRA_AUTHORITY_HOST: "http://127.0.0.1:1" }),
      clock,
      graphBaseUrl: "http://127.0.0.1:1",
    });
    await expect(unreachable.invite(invitation)).rejects.toThrow("could not be reached");
  });
});
