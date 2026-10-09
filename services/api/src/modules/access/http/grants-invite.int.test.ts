import type { AccessGrant } from "@kr/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { InvitationError } from "../domain/guest-inviter.js";
import { createAccessModule } from "../index.js";
import { createFakeGuestInviter } from "../testing.js";
import { MODULES } from "../../index.js";

type Grant = z.output<typeof AccessGrant>;

describe("guest invitations behind the entra-guest-invites flag (fake inviter)", () => {
  const inviter = createFakeGuestInviter();
  const modules = MODULES.map((m) => (m.name === "access" ? createAccessModule({ inviter }) : m));
  let on: TestApp, off: TestApp;
  let f: Factories;
  let staffOn: SignedIn, staffOff: SignedIn;
  const create = (t: TestApp, who: SignedIn, email: string, jobId: string, headers: Record<string, string> = {}) =>
    apiRequest(t, {
      method: "POST",
      url: "/v1/access-grants",
      as: who,
      headers,
      body: { email, displayName: "Pat", role: "client", jobId },
    });
  const events = (id: string) =>
    on.db.selectFrom("audit_events").select(["action", "changes"]).where("entity_id", "=", id).orderBy("id").execute();

  beforeAll(async () => {
    on = await createTestApp({ modules, flags: { "entra-guest-invites": true } });
    off = await createTestApp({ modules, flags: { "entra-guest-invites": false } });
    f = createFactories(on.db);
    staffOn = await signIn(on, await f.makeUser({ role: "staff" }));
    staffOff = await signIn(off, await f.makeUser({ role: "staff" }));
  });
  afterAll(async () => {
    await on.close();
    await off.close();
  });
  beforeEach(() => {
    inviter.invitations.length = 0;
  });

  it("does not call Graph when the flag is off", async () => {
    const res = await create(off, staffOff, "off@example.test", (await f.makeJob()).id);
    expect(res.statusCode).toBe(201);
    expect(res.json<Grant>().invitationStatus).toBe("not_sent");
    expect(inviter.invitations).toEqual([]);
  });

  it("invites the lower-cased email with the app as redirect and records it as sent", async () => {
    const job = await f.makeJob();
    const res = await create(on, staffOn, "Invite.Me@Example.test", job.id);
    expect(res.statusCode).toBe(201);
    const grant = res.json<Grant>();
    expect(grant).toMatchObject({ status: "pending", invitationStatus: "sent" });
    expect(inviter.invitations).toEqual([
      { email: "invite.me@example.test", displayName: "Pat", redirectUrl: on.deps.config.PUBLIC_BASE_URL },
    ]);
    expect((await events(grant.id)).map((e) => e.action)).toEqual([
      "access_grant.created",
      "access_grant.invitation_sent",
    ]);
    const row = await on.db
      .selectFrom("access_grants")
      .select(["invitation_status", "invitation_error"])
      .where("id", "=", grant.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ invitation_status: "sent", invitation_error: null });
  });

  it("records a failed invitation and still creates the grant; raw error text is not stored", async () => {
    inviter.failNextWith(
      new InvitationError("Microsoft Graph refused the invitation with 403 (Authorization_RequestDenied)."),
    );
    const res = await create(on, staffOn, "fail@example.test", (await f.makeJob()).id);
    expect(res.statusCode).toBe(201);
    const grant = res.json<Grant>();
    expect(grant).toMatchObject({ status: "pending", invitationStatus: "failed" });
    const row = await on.db
      .selectFrom("access_grants")
      .selectAll()
      .where("id", "=", grant.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      invitation_status: "failed",
      invitation_error: expect.stringContaining("403 (Authorization_RequestDenied)"),
    });
    expect((await events(grant.id)).map((e) => e.action)).toEqual([
      "access_grant.created",
      "access_grant.invitation_failed",
    ]);

    inviter.failNextWith(new TypeError("fetch failed: bearer abc123"));
    const other = await create(on, staffOn, "fail2@example.test", (await f.makeJob()).id);
    expect(other.statusCode).toBe(201);
    const stored = await on.db
      .selectFrom("access_grants")
      .select("invitation_error")
      .where("id", "=", other.json<Grant>().id)
      .executeTakeFirstOrThrow();
    expect(stored.invitation_error).toBe("The invitation could not be sent.");
  });

  it("sends no invitation for a duplicate, an existing external account or a replayed request", async () => {
    const job = await f.makeJob();
    await create(on, staffOn, "dup@example.test", job.id);
    expect((await create(on, staffOn, "dup@example.test", job.id)).statusCode).toBe(409);
    expect(inviter.invitations).toHaveLength(1);

    inviter.invitations.length = 0;
    await f.makeUser({ role: "external", email: "known@example.test" });
    const bound = await create(on, staffOn, "known@example.test", job.id);
    expect(bound.json<Grant>()).toMatchObject({ status: "active", invitationStatus: "not_sent" });

    const headers = { "idempotency-key": "invite-key-0001" };
    await create(on, staffOn, "again@example.test", job.id, headers);
    const replay = await create(on, staffOn, "again@example.test", job.id, headers);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(inviter.invitations.map((i) => i.email)).toEqual(["again@example.test"]);
  });
});
