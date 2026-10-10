/**
 * An unverified guest email (xms_edov=false) must never gain access through a grant (PRODUCT_SPEC §3.4, threat model
 * "Guest with an unverified or mutable email takes over a grant"): not when the grant is created after the account
 * exists, not at sign-in, and not through a grant that was bound while the email was still verified.
 */
import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { AccessGrant } from "@kr/contracts";
import { createFactories, type Factories } from "../../test/factories.js";
import { apiRequest, createTestApp, signIn, testConfig, type SignedIn, type TestApp } from "../helpers/index.js";
import { browserSignIn, cookieOf, mockUser, startIdpFor } from "../../src/modules/auth/testing.js";

type Grant = z.output<typeof AccessGrant>;

const guestOf = (n: number, o: Parameters<typeof mockUser>[1] = {}) =>
  mockUser(300 + n, {
    name: "Unverified Guest",
    acct: 1,
    email: `cleo.client${n}@example.com`,
    preferredUsername: `cleo.client${n}_example.com#EXT#@kr.test`,
    xmsEdov: false,
    ...o,
  });

describe("grants and unverified guest emails (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn;

  const repro = guestOf(2);
  const lapsing = guestOf(3, { xmsEdov: true });
  const verifies = guestOf(4);

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [repro, lapsing, verifies]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const browser = (u: { oid: string }) => browserSignIn(t.app, idp, { loginHint: u.oid });
  const sessionOf = (trip: Awaited<ReturnType<typeof browser>>) => cookieOf(trip.callback, "__Host-kr_session");
  const getJob = (jobId: string, cookieValue: string | undefined) =>
    t.app.inject({ url: `/v1/jobs/${jobId}`, headers: { cookie: `__Host-kr_session=${cookieValue}` } });
  const addGrant = (jobId: string, email: string) =>
    apiRequest(t, { method: "POST", url: "/v1/access-grants", as: staff, body: { email, role: "client", jobId } });
  const dbUser = (oid: string) =>
    t.db.selectFrom("users").selectAll().where("entra_object_id", "=", oid).executeTakeFirstOrThrow();
  const dbGrant = (id: string) =>
    t.db.selectFrom("access_grants").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  it("keeps a grant created after an unverified guest's first sign-in pending, and the job hidden", async () => {
    const job = await f.makeJob();
    const first = await browser(repro);
    const session = sessionOf(first);
    expect(first.callback.headers.location).toBe("/");
    expect(await dbUser(repro.oid)).toMatchObject({ email: repro.email, is_guest: true, role: "external" });

    const res = await addGrant(job.id, repro.email!);
    expect(res.statusCode).toBe(201);
    const grant = res.json<Grant>();
    expect(grant.status).toBe("pending");
    expect(await dbGrant(grant.id)).toMatchObject({ status: "pending", user_id: null, activated_at: null });

    // Signing in again (still xms_edov=false) is refused while a grant waits for this address ...
    const second = await browser(repro);
    expect(second.callback.headers.location).toBe("/sign-in-error?reason=unverified_email");
    expect(sessionOf(second)).toBeUndefined();
    expect(await dbGrant(grant.id)).toMatchObject({ status: "pending", user_id: null });
    // ... and the session from the first sign-in sees nothing of the job.
    expect((await getJob(job.id, session)).statusCode).toBe(404);
  });

  it("binds the grant when the same guest later signs in with a verified email", async () => {
    const job = await f.makeJob();
    const first = await browser(verifies);
    const unverifiedSession = sessionOf(first);
    const grant = (await addGrant(job.id, verifies.email!)).json<Grant>();
    expect(grant.status).toBe("pending");

    idp.addUser({ ...verifies, xmsEdov: true });
    const verified = await browser(verifies);
    const session = sessionOf(verified);
    expect(session).toBeDefined();
    const user = await dbUser(verifies.oid);
    expect(user.email_verified).toBe(true);
    expect(await dbGrant(grant.id)).toMatchObject({ status: "active", user_id: user.id });
    expect((await getJob(job.id, session)).statusCode).toBe(200);
    // The session of the unverified sign-in is the same account, so it now sees the job too: access follows the bound id.
    expect((await getJob(job.id, unverifiedSession)).statusCode).toBe(200);
  });

  it("binds immediately for a verified account (no change for a verified guest)", async () => {
    const job = await f.makeJob();
    await browser(lapsing);
    expect((await dbUser(lapsing.oid)).email_verified).toBe(true);
    const grant = (await addGrant(job.id, lapsing.email!)).json<Grant>();
    expect(grant.status).toBe("active");
    expect(await dbGrant(grant.id)).toMatchObject({ user_id: (await dbUser(lapsing.oid)).id });
  });

  it("refuses an account whose latest sign-in is unverified even with a grant bound earlier, and ends its sessions", async () => {
    const job = await f.makeJob();
    const other = await f.makeJob();
    const before = await browser(lapsing);
    const session = sessionOf(before);
    expect((await addGrant(job.id, lapsing.email!)).json<Grant>().status).toBe("active");
    expect((await getJob(job.id, session)).statusCode).toBe(200);

    idp.addUser({ ...lapsing, xmsEdov: false });
    const after = await browser(lapsing);
    expect(after.callback.headers.location).toBe("/sign-in-error?reason=unverified_email");
    expect(sessionOf(after)).toBeUndefined();
    expect((await dbUser(lapsing.oid)).email_verified).toBe(false);
    // The earlier session is gone, so the bound grant cannot be used from it.
    expect((await getJob(job.id, session)).statusCode).toBe(401);
    // A grant added now is not bound to the unverified account.
    const later = (await addGrant(other.id, lapsing.email!)).json<Grant>();
    expect(later.status).toBe("pending");
    expect(
      await t.db
        .selectFrom("audit_events")
        .select("changes")
        .where("action", "=", "auth.signin_refused")
        .where("actor_user_id", "=", (await dbUser(lapsing.oid)).id)
        .execute(),
    ).toHaveLength(1);
  });
});
