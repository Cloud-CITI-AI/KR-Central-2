import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { pdfBytes, seedFile } from "../testing.js";

describe("deleteFile (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const seed = (by: SignedIn | null, o: { checkpointKey?: string; slot?: string } = {}) =>
    seedFile(t, f, { jobId, data: pdfBytes(), ...(by ? { uploadedBy: by.user.id } : {}), ...o });
  const remove = (who: SignedIn | undefined, id: string, extra: { csrf?: null } = {}) =>
    apiRequest(t, { method: "DELETE", url: `/v1/files/${id}`, ...(who ? { as: who } : {}), ...extra });
  const row = (id: string) => t.db.selectFrom("files").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("staff remove any file: 204, soft delete with who and when, the object stays for the retention sweep", async () => {
    for (const who of [staff, admin, krAdmin]) {
      const file = await seed(client);
      const res = await remove(who, file.id);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(await row(file.id)).toMatchObject({
        deleted_by: who.user.id,
        deleted_at: t.deps.clock.now(),
        purged_at: null,
      });
      expect(await t.storage.exists(file.storage_key)).toBe(true);
    }
  });

  it("everyone else removes only their own uploads (403 otherwise, and nothing changes)", async () => {
    const mine = await seed(architect);
    const theirs = await seed(staff);
    expect((await remove(architect, theirs.id)).statusCode).toBe(403);
    expect((await remove(client, mine.id)).statusCode).toBe(403);
    expect((await row(theirs.id)).deleted_at).toBeNull();
    expect((await remove(architect, mine.id)).statusCode).toBe(204);
    const clients = await seed(client, { checkpointKey: "i3_0p", slot: "consent" });
    expect((await remove(client, clients.id)).statusCode).toBe(204);
  });

  it("a removed file is gone for everyone: getFile and content answer 404, and a second removal is a 404", async () => {
    const file = await seed(staff);
    await remove(staff, file.id);
    expect((await apiRequest(t, { url: `/v1/files/${file.id}`, as: admin })).statusCode).toBe(404);
    expect((await apiRequest(t, { url: `/v1/files/${file.id}/content`, as: admin })).statusCode).toBe(404);
    expect((await remove(admin, file.id)).statusCode).toBe(404);
  });

  it("writes one file.deleted audit row in the same transaction, with the name and no contents", async () => {
    const file = await seedFile(t, f, { jobId, data: pdfBytes(), name: "Old plan.pdf", uploadedBy: staff.user.id });
    await remove(krAdmin, file.id);
    const audits = await t.db.selectFrom("audit_events").selectAll().where("entity_id", "=", file.id).execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "file.deleted",
      entity_type: "file",
      job_id: jobId,
      actor_user_id: krAdmin.user.id,
    });
    expect(audits[0]?.changes).toEqual({
      deleted: { from: false, to: true },
      name: { from: "Old plan.pdf", to: null },
    });
  });

  it("404 for a file of a job the caller cannot see, the fee proposal's files without fee_proposal.view, and unknown ids", async () => {
    const file = await seed(staff);
    expect((await remove(outsider, file.id)).statusCode).toBe(404);
    const fee = await seed(staff, { checkpointKey: "i1_0p", slot: "documents" });
    expect((await remove(staff, fee.id)).statusCode).toBe(404);
    expect((await remove(krAdmin, fee.id)).statusCode).toBe(204);
    expect((await remove(admin, "4a1f0f3e-5b0d-4c1c-8f75-6a9c2d7d9e10")).statusCode).toBe(404);
    expect((await row(file.id)).deleted_at).toBeNull();
    const archived = await f.makeJob({ deletedAt: new Date() });
    const inArchived = await seedFile(t, f, { jobId: archived.id, data: pdfBytes() });
    expect((await remove(admin, inArchived.id)).statusCode).toBe(404);
  });

  it("needs a session, the CSRF token and a well-formed id", async () => {
    const file = await seed(staff);
    expect((await remove(undefined, file.id)).statusCode).toBe(401);
    expect((await remove(staff, file.id, { csrf: null })).statusCode).toBe(403);
    expect((await remove(staff, "not-a-uuid")).statusCode).toBe(400);
    expect((await row(file.id)).deleted_at).toBeNull();
  });
});
