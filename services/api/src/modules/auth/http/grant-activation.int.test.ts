import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { browserSignIn, mockUser, startIdpFor } from "../testing.js";

const guest = (n: number, email: string | null, o: Parameters<typeof mockUser>[1] = {}) =>
  mockUser(200 + n, { acct: 1, email, preferredUsername: `guest${n}_client.test#EXT#@kr.test`, ...o });

const grace = guest(1, "grace.guest@client.test");
const upnOnly = guest(2, null, { preferredUsername: "upn.only@client.test" });
const unverified = guest(3, "unverified@client.test", { xmsEdov: false });
const unverifiedNoGrants = guest(4, "nogrants@client.test", { xmsEdov: false });
const mixed = guest(5, "mixed@client.test");
const member = mockUser(206, {
  email: "member.client@outsider.test",
  preferredUsername: "member.client@outsider.test",
});
const crowded = guest(7, "crowded@client.test");
const mover = guest(8, "first.address@client.test");

describe("grant activation at sign-in (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [
      grace,
      upnOnly,
      unverified,
      unverifiedNoGrants,
      mixed,
      member,
      crowded,
      mover,
    ]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
    f = createFactories(t.db);
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const signIn = (u: { email: string | null; oid: string }) => browserSignIn(t.app, idp, { loginHint: u.oid });
  const userId = async (oid: string) =>
    (await t.db.selectFrom("users").select("id").where("entra_object_id", "=", oid).executeTakeFirstOrThrow()).id;
  const grantRow = (id: string) =>
    t.db.selectFrom("access_grants").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  it("activates every pending grant for the email claim, case-insensitively, binds the user id and audits each", async () => {
    const [a, b] = [await f.makeJob(), await f.makeJob()];
    const ga = await f.makeGrant({ jobId: a.id, status: "pending", email: "Grace.Guest@Client.TEST", role: "client" });
    const gb = await f.makeGrant({
      jobId: b.id,
      status: "pending",
      email: "grace.guest@client.test",
      role: "architect",
    });
    const trip = await signIn(grace);
    expect(trip.callback.headers.location).toBe("/");
    const id = await userId(grace.oid);
    for (const [grant, job] of [
      [ga, a],
      [gb, b],
    ] as const) {
      expect(await grantRow(grant.id)).toMatchObject({ status: "active", user_id: id, job_id: job.id });
      expect((await grantRow(grant.id)).activated_at?.toISOString()).toBe("2026-03-02T01:00:00.000Z");
    }
    const events = await t.db
      .selectFrom("audit_events")
      .select(["action", "job_id", "entity_id", "actor_user_id", "changes"])
      .where("action", "=", "grant.activated")
      .where("actor_user_id", "=", id)
      .execute();
    expect(events.map((e) => e.job_id).sort()).toEqual([a.id, b.id].sort());
    expect(events[0]).toMatchObject({
      changes: { status: { from: "pending", to: "active" }, user_id: { from: null, to: id } },
    });
  });

  it("does not activate from preferred_username: a guest token without an email claim matches nothing", async () => {
    const job = await f.makeJob();
    const grant = await f.makeGrant({ jobId: job.id, status: "pending", email: "upn.only@client.test" });
    expect((await signIn(upnOnly)).callback.headers.location).toBe("/");
    expect(await grantRow(grant.id)).toMatchObject({ status: "pending", user_id: null });
  });

  it("refuses an unverified email domain (xms_edov=false) with reason=unverified_email and changes nothing", async () => {
    const job = await f.makeJob();
    const grant = await f.makeGrant({ jobId: job.id, status: "pending", email: "unverified@client.test" });
    const trip = await signIn(unverified);
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=unverified_email");
    expect(trip.callback.cookies.find((c) => c.name === "__Host-kr_session")).toBeUndefined();
    expect(await grantRow(grant.id)).toMatchObject({ status: "pending", user_id: null });
    expect(await t.db.selectFrom("users").select("id").where("entra_object_id", "=", unverified.oid).execute()).toEqual(
      [],
    );
  });

  it("lets an unverified guest in when no grant is waiting for them", async () => {
    expect((await signIn(unverifiedNoGrants)).callback.headers.location).toBe("/");
  });

  it("activates only grants on jobs that are not archived, and leaves revoked and already-bound grants alone", async () => {
    const [open, archived, other, other2] = [
      await f.makeJob(),
      await f.makeJob({ deletedAt: new Date("2026-02-01T00:00:00Z") }),
      await f.makeJob(),
      await f.makeJob(),
    ];
    const email = "mixed@client.test";
    const live = await f.makeGrant({ jobId: open.id, status: "pending", email });
    const gone = await f.makeGrant({ jobId: archived.id, status: "pending", email });
    const revoked = await f.makeGrant({ jobId: other.id, status: "revoked", email });
    const someoneElse = await f.makeUser({ role: "external" });
    const bound = await f.makeGrant({ jobId: other2.id, status: "active", email, userId: someoneElse.id });
    await signIn(mixed);
    expect(await grantRow(live.id)).toMatchObject({ status: "active", user_id: await userId(mixed.oid) });
    expect(await grantRow(gone.id)).toMatchObject({ status: "pending", user_id: null });
    expect(await grantRow(revoked.id)).toMatchObject({ status: "revoked", user_id: null });
    expect(await grantRow(bound.id)).toMatchObject({ status: "active", user_id: someoneElse.id });
  });

  it("matches a tenant member by their step-4 email too", async () => {
    const job = await f.makeJob();
    const grant = await f.makeGrant({ jobId: job.id, status: "pending", email: member.email!, role: "architect" });
    await signIn(member);
    expect(await grantRow(grant.id)).toMatchObject({ status: "active", user_id: await userId(member.oid) });
  });

  it("keeps access with the user id when the email changes later; a new address activates only new grants", async () => {
    const [first, second] = [await f.makeJob(), await f.makeJob()];
    const g1 = await f.makeGrant({ jobId: first.id, status: "pending", email: "first.address@client.test" });
    await signIn(mover);
    const id = await userId(mover.oid);
    idp.addUser({ ...mover, email: "second.address@client.test" });
    const g2 = await f.makeGrant({ jobId: second.id, status: "pending", email: "second.address@client.test" });
    await signIn(mover);
    expect(await grantRow(g1.id)).toMatchObject({ status: "active", user_id: id });
    expect(await grantRow(g2.id)).toMatchObject({ status: "active", user_id: id });
    expect(await t.db.selectFrom("users").select("email").where("id", "=", id).executeTakeFirstOrThrow()).toEqual({
      email: "second.address@client.test",
    });
  });

  it("audits a sign-in without grants as just user.created and auth.signin", async () => {
    await signIn(crowded);
    const id = await userId(crowded.oid);
    const actions = await t.db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_id", "=", id)
      .orderBy("id")
      .execute();
    expect(actions.map((a) => a.action)).toEqual(["user.created", "auth.signin"]);
  });
});
