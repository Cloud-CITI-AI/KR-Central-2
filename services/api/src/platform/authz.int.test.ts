import { globalCapabilitiesFor, jobCapabilitiesFor, type GlobalRole } from "@kr/contracts";
import { createDb, type Db } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import type { AuthContext } from "./auth-context.js";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { resolveJobAccess } from "./authz.js";

function asUser(id: string, role: GlobalRole): AuthContext {
  return {
    user: { id, displayName: "T", email: null, role, isGuest: role === "external" },
    session: {
      idHash: Buffer.alloc(32),
      csrfToken: "x".repeat(43),
      authTime: new Date(0),
      amr: [],
      acrs: [],
      idleExpiresAt: new Date(0),
      absoluteExpiresAt: new Date(0),
    },
    globalCapabilities: globalCapabilitiesFor(role),
    authzChecked: false,
  };
}

describe("resolveJobAccess (real Postgres)", () => {
  let db: Db;
  let f: Factories;
  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
    f = createFactories(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  const as = async (role: GlobalRole) => asUser((await f.makeUser({ role })).id, role);

  it("staff, kr_admin and admin see any job with their role's capabilities", async () => {
    const job = await f.makeJob();
    for (const role of ["staff", "kr_admin", "admin"] as const) {
      const a = await as(role);
      const access = await resolveJobAccess(db, a, job.id);
      expect(access.job.id).toBe(job.id);
      expect(access.grantRole).toBeNull();
      expect(access.capabilities).toEqual(jobCapabilitiesFor(role, null));
      expect(a.authzChecked).toBe(true);
    }
  });

  it("externals see a job only through an ACTIVE grant, with the grant role's capabilities", async () => {
    const job = await f.makeJob();
    const client = await as("external");
    const architect = await as("external");
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    const c = await resolveJobAccess(db, client, job.id);
    expect([c.grantRole, c.capabilities]).toEqual(["client", jobCapabilitiesFor("external", "client")]);
    const a = await resolveJobAccess(db, architect, job.id);
    expect([a.grantRole, a.capabilities]).toEqual(["architect", jobCapabilitiesFor("external", "architect")]);
  });

  it("is 404 for no grant, a pending grant, a revoked grant, a grant on another job and an archived job", async () => {
    const job = await f.makeJob();
    const other = await f.makeJob();
    const archived = await f.makeJob({ deletedAt: new Date() });
    const noGrant = await as("external");
    const pending = await as("external");
    const revoked = await as("external");
    const elsewhere = await as("external");
    await f.makeGrant({ jobId: job.id, status: "pending", userId: pending.user.id });
    await f.makeGrant({ jobId: job.id, status: "revoked", userId: revoked.user.id });
    await f.makeGrant({ jobId: other.id, userId: elsewhere.user.id });
    await f.makeGrant({ jobId: archived.id, userId: noGrant.user.id });
    for (const a of [noGrant, pending, revoked, elsewhere]) {
      await expect(resolveJobAccess(db, a, job.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(resolveJobAccess(db, noGrant, archived.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("archived and unknown jobs are the same 404 even for admins (existence is not disclosed)", async () => {
    const archived = await f.makeJob({ deletedAt: new Date() });
    const admin = await as("admin");
    const missing = await resolveJobAccess(db, admin, "0f8fad5b-d9cb-469f-a165-70867728950e").catch((e: unknown) => e);
    const hidden = await resolveJobAccess(db, admin, archived.id).catch((e: unknown) => e);
    expect(hidden).toBeInstanceOf(NotFoundError);
    expect(String(hidden)).toBe(String(missing));
  });

  it("is 403 when a visible job lacks the required capability, 404 taking precedence for invisible ones", async () => {
    const job = await f.makeJob();
    const staff = await as("staff");
    await expect(resolveJobAccess(db, staff, job.id, "job.delete")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resolveJobAccess(db, await as("admin"), job.id, "job.delete")).resolves.toBeDefined();
    const architect = await as("external");
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    await expect(resolveJobAccess(db, architect, job.id, ["job.read", "job.edit"])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(resolveJobAccess(db, await as("external"), job.id, "job.delete")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("revoking a grant takes effect on the very next call", async () => {
    const job = await f.makeJob();
    const client = await as("external");
    const grant = await f.makeGrant({ jobId: job.id, userId: client.user.id });
    await expect(resolveJobAccess(db, client, job.id)).resolves.toBeDefined();
    await db
      .updateTable("access_grants")
      .set({ status: "revoked", revoked_at: new Date() })
      .where("id", "=", grant.id)
      .execute();
    await expect(resolveJobAccess(db, client, job.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
