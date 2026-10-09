import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { pdfBytes, pngBytes, readZip, seedFile, textBytes } from "../testing.js";

describe("downloadJobPackage (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const download = (who: SignedIn | undefined, jobId: string) =>
    apiRequest(t, { url: `/v1/jobs/${jobId}/package`, ...(who ? { as: who } : {}) });
  const job = async (o: { jobNumber: string; address?: string }) => {
    const created = await f.makeJob({ jobNumber: o.jobNumber });
    await t.db
      .updateTable("jobs")
      .set({ address: o.address ?? "1 Example Street, Testville" })
      .where("id", "=", created.id)
      .execute();
    await f.makeGrant({ jobId: created.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: created.id, userId: architect.user.id, role: "architect" });
    return created;
  };

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("streams a zip named after the job, with the layout of PRODUCT_SPEC 5.8, Job summary.txt first", async () => {
    const j = await job({ jobNumber: "PK-0001" });
    const survey = pdfBytes(120, "survey");
    const photo = pngBytes();
    const email = textBytes("Subject: Query\n");
    await seedFile(t, f, { jobId: j.id, data: survey, name: "Site survey.pdf", checkpointKey: "i2_0", slot: "survey" });
    await seedFile(t, f, {
      jobId: j.id,
      data: photo,
      name: "Front.png",
      kind: "image",
      contentType: "image/png",
      checkpointKey: "i11_0",
      slot: "photos",
    });
    await seedFile(t, f, {
      jobId: j.id,
      data: email,
      name: "Query.txt",
      kind: "email",
      contentType: "text/plain",
      checkpointKey: "i4_3",
      slot: "email",
    });
    const condition = await f.makeCondition({ jobId: j.id, number: 4, agency: "Western Power" });
    await seedFile(t, f, {
      jobId: j.id,
      data: photo,
      name: "Pole.png",
      kind: "image",
      contentType: "image/png",
      conditionId: condition.id,
    });

    const res = await download(client, j.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="PK-0001 _ subdivision files.zip"; filename*=UTF-8''PK-0001%20%E2%80%93%20subdivision%20files.zip`,
      "cache-control": "private, no-store",
    });
    const zip = await readZip(res.rawPayload);
    const top = "PK-0001 – 1 Example Street, Testville";
    expect([...zip.keys()]).toEqual([
      `${top}/Job summary.txt`,
      `${top}/01 Preliminaries/2.0 Site Feature Survey/Site survey.pdf`,
      `${top}/02 WAPC Approval/4.3 Queries from WAPC/Query emails/Query.txt`,
      `${top}/03 Western Power/WAPC conditions/Condition 4 evidence/Pole.png`,
      `${top}/08 Survey/11.0 Surround Survey & Western Power set-out/Front.png`,
    ]);
    expect(zip.get(`${top}/01 Preliminaries/2.0 Site Feature Survey/Site survey.pdf`)).toEqual(survey);
    expect(zip.get(`${top}/08 Survey/11.0 Surround Survey & Western Power set-out/Front.png`)).toEqual(photo);
    expect(zip.get(`${top}/Job summary.txt`)?.toString("utf8").split("\r\n")[0]).toContain(
      "PK-0001 – 1 Example Street, Testville",
    );
  });

  it("holds only clean and skipped files that were not removed", async () => {
    const j = await job({ jobNumber: "PK-0002" });
    for (const scanStatus of ["clean", "skipped", "pending", "infected", "error"] as const) {
      await seedFile(t, f, {
        jobId: j.id,
        data: pdfBytes(),
        name: `${scanStatus}.pdf`,
        checkpointKey: "i2_0",
        slot: "survey",
        scanStatus,
      });
    }
    const removed = await seedFile(t, f, {
      jobId: j.id,
      data: pdfBytes(),
      name: "removed.pdf",
      checkpointKey: "i2_0",
      slot: "survey",
    });
    await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", removed.id).execute();
    const names = [...(await readZip((await download(staff, j.id)).rawPayload)).keys()].map((k) => k.split("/").pop());
    expect(names).toEqual(["Job summary.txt", "clean.pdf", "skipped.pdf"]);
  });

  it("includes the fee proposal's files only for fee_proposal.view holders", async () => {
    const j = await job({ jobNumber: "PK-0003" });
    await seedFile(t, f, { jobId: j.id, data: pdfBytes(), name: "fee.pdf", checkpointKey: "i1_0p", slot: "documents" });
    await seedFile(t, f, { jobId: j.id, data: pdfBytes(), name: "survey.pdf", checkpointKey: "i2_0", slot: "survey" });
    const names = async (who: SignedIn) =>
      [...(await readZip((await download(who, j.id)).rawPayload)).keys()].map((k) => k.split("/").pop());
    for (const who of [admin, krAdmin, client]) expect(await names(who), who.user.role).toContain("fee.pdf");
    for (const who of [staff, architect]) expect(await names(who)).toEqual(["Job summary.txt", "survey.pdf"]);
  });

  it("is open to everyone with access to the job (package.download); 404 for others, archived jobs; 401 without a session", async () => {
    const j = await job({ jobNumber: "PK-0004" });
    for (const who of [admin, krAdmin, staff, client, architect])
      expect((await download(who, j.id)).statusCode).toBe(200);
    expect((await download(outsider, j.id)).statusCode).toBe(404);
    const archived = await f.makeJob({ deletedAt: new Date() });
    expect((await download(admin, archived.id)).statusCode).toBe(404);
    expect((await download(undefined, j.id)).statusCode).toBe(401);
    expect((await download(admin, "not-a-uuid")).statusCode).toBe(400);
  });
});
