import { globalCapabilitiesFor, type GlobalRole } from "@kr/contracts";
import { createDb, type Db } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createFactories, type Factories } from "../../../test/factories.js";
import type { AuthContext } from "../../platform/auth-context.js";
import { resolveJobAccess } from "../../platform/authz.js";
import { NotFoundError } from "../../platform/errors.js";
import { visibleJobs } from "./jobs-visibility.js";

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

describe("visibleJobs (real Postgres)", () => {
  let db: Db;
  let f: Factories;
  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
    f = createFactories(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it("matches resolveJobAccess for every caller and job, and hides archived jobs from everyone", async () => {
    const granted = await f.makeJob();
    const pending = await f.makeJob();
    const archived = await f.makeJob({ deletedAt: new Date() });
    const ungranted = await f.makeJob();
    const mine = [granted, pending, archived, ungranted];
    const external = asUser((await f.makeUser({ role: "external" })).id, "external");
    await f.makeGrant({ jobId: granted.id, userId: external.user.id });
    await f.makeGrant({ jobId: pending.id, userId: external.user.id, status: "pending" });
    await f.makeGrant({ jobId: archived.id, userId: external.user.id });
    const callers = [
      external,
      ...(await Promise.all(
        ["staff", "kr_admin", "admin"].map(async (r) =>
          asUser((await f.makeUser({ role: r as GlobalRole })).id, r as GlobalRole),
        ),
      )),
    ];

    for (const caller of callers) {
      const visible = (
        await db
          .selectFrom("jobs")
          .select("id")
          .where(
            "id",
            "in",
            mine.map((j) => j.id),
          )
          .where(visibleJobs(caller))
          .execute()
      ).map((r) => r.id);
      for (const job of mine) {
        const canResolve = await resolveJobAccess(db, caller, job.id).then(
          () => true,
          (e: unknown) => (e instanceof NotFoundError ? false : Promise.reject(e as Error)),
        );
        expect(visible.includes(job.id), `${caller.user.role} on ${job.job_number}`).toBe(canResolve);
      }
    }
    expect(
      callers[0] &&
        (
          await db
            .selectFrom("jobs")
            .select("id")
            .where(
              "id",
              "in",
              mine.map((j) => j.id),
            )
            .where(visibleJobs(callers[0]))
            .execute()
        ).map((r) => r.id),
    ).toEqual([granted.id]);
  });

  it("composes with other filters and counts", async () => {
    const job = await f.makeJob();
    const staff = asUser((await f.makeUser({ role: "staff" })).id, "staff");
    const row = await db
      .selectFrom("jobs")
      .select(db.fn.countAll<string>().as("n"))
      .where(visibleJobs(staff))
      .where("job_number", "=", job.job_number)
      .executeTakeFirstOrThrow();
    expect(Number(row.n)).toBe(1);
  });
});
