import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TENANT_ID } from "../../../../test/factories.js";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { sha256 } from "../data/auth-flows.js";
import { browserSignIn, cookieOf, mockUser, startIdpFor } from "../testing.js";

const member = mockUser(11);
const guest = mockUser(12, {
  acct: 1,
  email: "guest@client.test",
  preferredUsername: "guest_client.test#EXT#@kr.test",
});
const foreign = mockUser(13, { tid: "99999999-9999-4999-8999-999999999999" });
const disabled = mockUser(14);

describe("completeLogin: token, tenant and account checks (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [member, guest, foreign, disabled]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
    await t.db
      .insertInto("users")
      .values({
        entra_tenant_id: TEST_TENANT_ID,
        entra_object_id: disabled.oid,
        email: disabled.email,
        display_name: "Off",
        role: "external",
        is_guest: false,
        status: "disabled",
      })
      .execute();
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const row = (oid: string) =>
    t.db.selectFrom("users").selectAll().where("entra_object_id", "=", oid).executeTakeFirst();
  const state = (url: URL) => sha256(url.searchParams.get("state") ?? "");

  it("treats a guest as external and takes the email from the email claim, not the UPN", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: guest.oid });
    expect(trip.callback.statusCode).toBe(302);
    expect(await row(guest.oid)).toMatchObject({ is_guest: true, role: "external", email: "guest@client.test" });
  });

  it("updates name and last sign-in on a later sign-in but keeps the user and the role", async () => {
    await browserSignIn(t.app, idp, { loginHint: member.email! });
    const before = await row(member.oid);
    await t.db
      .updateTable("users")
      .set({ display_name: "Old Name", role: "kr_admin" })
      .where("id", "=", before!.id)
      .execute();
    t.clock.advance(3_600_000);
    await browserSignIn(t.app, idp, { loginHint: member.email! });
    const after = await row(member.oid);
    expect(after).toMatchObject({ id: before?.id, display_name: "Test Person 11", role: "kr_admin" });
    expect(after?.last_sign_in_at?.toISOString()).toBe("2026-03-02T02:00:00.000Z");
  });

  it("revokes the session the browser presented (fixation) and issues a different id", async () => {
    const first = await browserSignIn(t.app, idp, { loginHint: guest.oid });
    const old = cookieOf(first.callback, "__Host-kr_session")!;
    const second = await browserSignIn(t.app, idp, { loginHint: guest.oid, cookies: { "__Host-kr_session": old } });
    expect(cookieOf(second.callback, "__Host-kr_session")).not.toBe(old);
    const revoked = await t.db
      .selectFrom("sessions")
      .select("revoked_reason")
      .where("id_hash", "=", sha256(old))
      .executeTakeFirst();
    expect(revoked?.revoked_reason).toBe("rotated");
    expect(
      (await t.app.inject({ url: "/test/whoami", headers: { cookie: `__Host-kr_session=${old}` } })).statusCode,
    ).toBe(401);
  });

  it.each([
    [
      "a state that was never issued",
      (u: URL) => {
        u.searchParams.set("state", "x".repeat(43));
      },
    ],
    [
      "a missing state",
      (u: URL) => {
        u.searchParams.delete("state");
      },
    ],
  ])("refuses %s with reason=expired", async (_name, tamper) => {
    const trip = await browserSignIn(t.app, idp, { loginHint: member.email!, beforeCallback: tamper });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=expired");
  });

  it("fails a nonce that differs from the one stored with the flow", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: member.email!,
      beforeCallback: async (url) => {
        await t.db.updateTable("auth_flows").set({ nonce: "tampered" }).where("state_hash", "=", state(url)).execute();
      },
    });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=failed");
  });

  it("fails a tampered authorization code", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: member.email!,
      beforeCallback: (url) => {
        url.searchParams.set("code", "not-the-code");
      },
    });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=failed");
  });

  it("maps another tenant's token to reason=wrong_tenant and creates nothing", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: foreign.oid });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=wrong_tenant");
    expect(await row(foreign.oid)).toBeUndefined();
  });

  it("maps a disabled user to reason=disabled, with no session and no changes", async () => {
    const before = await row(disabled.oid);
    const trip = await browserSignIn(t.app, idp, { loginHint: disabled.oid });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=disabled");
    expect(trip.callback.cookies.find((c) => c.name === "__Host-kr_session")).toBeUndefined();
    expect(await row(disabled.oid)).toEqual(before);
    expect(await t.db.selectFrom("sessions").select("id_hash").where("user_id", "=", before!.id).execute()).toEqual([]);
  });

  it("logs security events with pseudonymised identifiers only", async () => {
    await browserSignIn(t.app, idp, { loginHint: foreign.oid });
    await browserSignIn(t.app, idp, { loginHint: guest.oid });
    const lines = t.logLines().filter((l) => String(l.event).startsWith("authn_"));
    expect(lines.map((l) => l.event)).toEqual(expect.arrayContaining(["authn_failure", "authn_success"]));
    const text = JSON.stringify(lines);
    for (const secret of [guest.oid, guest.email!, member.email!, "code=", "code_verifier"])
      expect(text).not.toContain(secret);
    expect(lines.find((l) => l.event === "authn_success")).toMatchObject({
      subject: expect.stringMatching(/^[0-9a-f]{16}$/) as string,
    });
  });
});
