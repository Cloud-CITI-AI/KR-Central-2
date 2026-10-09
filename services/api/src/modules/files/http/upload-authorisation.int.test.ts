import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { dwgBytes, multipartBody, pdfBytes, pngBytes, uploadFile } from "../testing.js";

interface UploadBody {
  file: Record<string, unknown> & { id: string };
}

describe("uploadFile authorisation (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const fresh = async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return job;
  };
  const filesOf = (jobId: string) => t.db.selectFrom("files").selectAll().where("job_id", "=", jobId).execute();
  const slotUpload = (
    jobId: string,
    who: SignedIn | undefined,
    key: string,
    slot: string,
    name: string,
    data: Buffer,
  ) =>
    uploadFile(t, { jobId, ...(who ? { as: who } : {}), fields: { checkpointKey: key, slot }, file: { name, data } });

  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ RATE_LIMIT_UPLOADS_PER_MINUTE: "1000" }) });
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  describe("authorisation (PRODUCT_SPEC §2.1)", () => {
    it.each([
      ["admin", () => admin, "i2_0", "survey", 201],
      ["staff", () => staff, "i2_0", "survey", 201],
      ["client into a staff slot", () => client, "i2_0", "survey", 403],
      ["architect into a staff slot", () => architect, "i2_0", "survey", 403],
      ["staff into a staff + client slot", () => staff, "i3_0p", "consent", 201],
      ["client into a staff + client slot", () => client, "i3_0p", "consent", 201],
      ["architect into a staff + client slot", () => architect, "i3_0p", "consent", 403],
    ] as const)("%s: %i", async (_who, who, key, slot, status) => {
      const job = await fresh();
      const res = await slotUpload(job.id, who(), key, slot, "a.pdf", pdfBytes());
      expect(res.statusCode).toBe(status);
      expect(await filesOf(job.id)).toHaveLength(status === 201 ? 1 : 0);
    });

    it("the fee proposal slot takes uploads only from fee_proposal.view holders who may upload there", async () => {
      const job = await fresh();
      const send = (who: SignedIn) => slotUpload(job.id, who, "i1_0p", "documents", "fee.pdf", pdfBytes());
      expect((await send(staff)).statusCode).toBe(403);
      expect((await send(client)).statusCode).toBe(403);
      expect((await send(architect)).statusCode).toBe(403);
      expect((await send(krAdmin)).statusCode).toBe(201);
      expect((await send(admin)).statusCode).toBe(201);
    });

    it("answers 404 for a caller who cannot see the job, an archived job and an unknown job", async () => {
      const job = await fresh();
      expect((await slotUpload(job.id, outsider, "i2_0", "survey", "a.pdf", pdfBytes())).statusCode).toBe(404);
      const archived = await f.makeJob({ deletedAt: new Date() });
      expect((await slotUpload(archived.id, admin, "i2_0", "survey", "a.pdf", pdfBytes())).statusCode).toBe(404);
      const missing = "2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77";
      expect((await slotUpload(missing, admin, "i2_0", "survey", "a.pdf", pdfBytes())).statusCode).toBe(404);
    });

    it("needs a session and the CSRF token", async () => {
      const job = await fresh();
      expect((await slotUpload(job.id, undefined, "i2_0", "survey", "a.pdf", pdfBytes())).statusCode).toBe(401);
      const { payload, headers } = multipartBody(
        { checkpointKey: "i2_0", slot: "survey" },
        { name: "a.pdf", data: pdfBytes() },
      );
      const noCsrf = await apiRequest(t, {
        method: "POST",
        url: `/v1/jobs/${job.id}/files`,
        as: staff,
        csrf: null,
        body: payload,
        headers,
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(await filesOf(job.id)).toEqual([]);
    });
  });

  describe("condition evidence", () => {
    it("takes evidence for a current condition of the same job from every role with a grant", async () => {
      const job = await fresh();
      const condition = await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
      for (const who of [staff, client, architect]) {
        const res = await uploadFile(t, {
          jobId: job.id,
          as: who,
          fields: { conditionId: condition.id },
          file: { name: "evidence.png", data: pngBytes() },
        });
        expect(res.statusCode, who.user.role).toBe(201);
        expect(res.json<UploadBody>().file).toMatchObject({
          conditionId: condition.id,
          checkpointKey: null,
          slot: null,
          kind: "image",
        });
      }
      const audits = await t.db.selectFrom("audit_events").select("changes").where("job_id", "=", job.id).execute();
      expect(audits[0]?.changes).toMatchObject({ conditionId: { from: null, to: condition.id } });
    });

    it("404 for a superseded condition and for a condition of another job; 403 without the capability", async () => {
      const job = await fresh();
      const other = await fresh();
      const old = await f.makeCondition({ jobId: job.id, number: 1 });
      await t.db.updateTable("conditions").set({ superseded_at: new Date() }).where("id", "=", old.id).execute();
      const foreign = await f.makeCondition({ jobId: other.id, number: 1 });
      const send = (who: SignedIn, conditionId: string) =>
        uploadFile(t, { jobId: job.id, as: who, fields: { conditionId }, file: { name: "e.pdf", data: pdfBytes() } });
      expect((await send(staff, old.id)).statusCode).toBe(404);
      expect((await send(staff, foreign.id)).statusCode).toBe(404);
      expect((await send(outsider, old.id)).statusCode).toBe(404);
      expect(await filesOf(job.id)).toEqual([]);
    });

    it("evidence takes the generic kinds only", async () => {
      const job = await fresh();
      const condition = await f.makeCondition({ jobId: job.id, number: 1 });
      const dwg = await uploadFile(t, {
        jobId: job.id,
        as: staff,
        fields: { conditionId: condition.id },
        file: { name: "e.dwg", data: dwgBytes() },
      });
      expect(dwg.statusCode).toBe(415);
      expect(dwg.json<{ detail: string }>().detail).toBe("This box accepts PDF, photo, video or text files only.");
    });
  });
});
