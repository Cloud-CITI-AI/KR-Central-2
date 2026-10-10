import type { FileMeta } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { pdfBytes, seedFile } from "../testing.js";

describe("getFile (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const get = (who: SignedIn | undefined, id: string) =>
    apiRequest(t, { url: `/v1/files/${id}`, ...(who ? { as: who } : {}) });
  const seed = (o: { by?: SignedIn; checkpointKey?: string; slot?: string; scan?: "pending" | "infected" }) =>
    seedFile(t, f, {
      jobId,
      data: pdfBytes(),
      ...(o.by ? { uploadedBy: o.by.user.id } : {}),
      ...(o.checkpointKey ? { checkpointKey: o.checkpointKey } : {}),
      ...(o.slot ? { slot: o.slot } : {}),
      ...(o.scan ? { scanStatus: o.scan } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
    const job = await f.makeJob();
    jobId = job.id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("returns the metadata with the scan status, the uploader's name and whether the caller may remove it", async () => {
    const file = await seed({ by: client, checkpointKey: "i3_0p", slot: "consent", scan: "pending" });
    const res = await get(client, file.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<FileMeta>()).toMatchObject({
      id: file.id,
      jobId,
      checkpointKey: "i3_0p",
      slot: "consent",
      name: file.original_name,
      kind: "pdf",
      scanStatus: "pending",
      uploadedBy: { id: client.user.id, displayName: client.user.display_name },
      canDelete: true,
      email: null,
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("canDelete: staff any file, others only their own uploads (PRODUCT_SPEC 2.1)", async () => {
    const own = await seed({ by: architect, checkpointKey: "i2_0", slot: "survey" });
    const theirs = await seed({ by: staff, checkpointKey: "i2_0", slot: "survey" });
    const canDelete = async (who: SignedIn, id: string) => (await get(who, id)).json<FileMeta>().canDelete;
    expect([await canDelete(staff, own.id), await canDelete(admin, own.id), await canDelete(krAdmin, own.id)]).toEqual([
      true,
      true,
      true,
    ]);
    expect(await canDelete(architect, own.id)).toBe(true);
    expect(await canDelete(architect, theirs.id)).toBe(false);
    expect(await canDelete(client, own.id)).toBe(false);
  });

  it("carries the email record of an email file", async () => {
    const file = await seedFile(t, f, {
      jobId,
      data: Buffer.from("From: a@example.test\r\nTo: b@example.test\r\n\r\nhi"),
      kind: "email",
      contentType: "message/rfc822",
      checkpointKey: "i4_3",
      slot: "email",
    });
    await f.makeEmail(file.id);
    const meta = (await get(staff, file.id)).json<FileMeta>();
    expect(meta.email).toMatchObject({ parseStatus: "parsed", isPasted: false, from: "assessor@example.test" });
  });

  describe("email body (the viewer's text rendering, PRODUCT_SPEC 10.3)", () => {
    const seedEmail = async (scan: "pending" | "clean" | "infected", body: string | null) => {
      const file = await seedFile(t, f, {
        jobId,
        data: Buffer.from("From: a@example.test\r\n\r\nraw mime"),
        kind: "email",
        contentType: "message/rfc822",
        checkpointKey: "i4_3",
        slot: "email",
        scanStatus: scan,
      });
      await f.makeEmail(file.id);
      await t.db.updateTable("email_messages").set({ body_text: body }).where("file_id", "=", file.id).execute();
      return file;
    };

    it("carries the parsed body to everyone who may see the file", async () => {
      const file = await seedEmail("clean", "Plain version café continued");
      for (const who of [admin, krAdmin, staff, client, architect]) {
        const meta = (await get(who, file.id)).json<FileMeta>();
        expect(meta.email?.bodyText).toBe("Plain version café continued");
      }
    });

    it("answers 404, with no body, to a user who may not see the file", async () => {
      const file = await seedEmail("clean", "Private query text");
      const res = await get(outsider, file.id);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("Private query text");
    });

    it("withholds the body while the file is unscanned or blocked, as the content route does", async () => {
      for (const scan of ["pending", "infected"] as const) {
        const file = await seedEmail(scan, "Not yet safe to show");
        const res = await get(admin, file.id);
        expect(res.json<FileMeta>().email).toMatchObject({ parseStatus: "parsed", bodyText: null });
        expect(res.body).not.toContain("Not yet safe to show");
      }
    });

    it("is null when the message has no text", async () => {
      const file = await seedEmail("clean", null);
      expect((await get(admin, file.id)).json<FileMeta>().email?.bodyText).toBeNull();
    });
  });

  it("hides the fee proposal's files from everyone without fee_proposal.view (404, as for no file)", async () => {
    const file = await seed({ checkpointKey: "i1_0p", slot: "documents" });
    for (const who of [admin, krAdmin, client]) expect((await get(who, file.id)).statusCode).toBe(200);
    for (const who of [staff, architect]) expect((await get(who, file.id)).statusCode).toBe(404);
  });

  it("answers 404 for a removed file, an unknown file, a file of a job the caller cannot see and an archived job", async () => {
    const removed = await seed({});
    await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", removed.id).execute();
    expect((await get(admin, removed.id)).statusCode).toBe(404);
    expect((await get(admin, "4a1f0f3e-5b0d-4c1c-8f75-6a9c2d7d9e10")).statusCode).toBe(404);
    const visible = await seed({});
    expect((await get(outsider, visible.id)).statusCode).toBe(404);
    const archived = await f.makeJob({ deletedAt: new Date() });
    const inArchived = await seedFile(t, f, { jobId: archived.id, data: pdfBytes() });
    expect((await get(admin, inArchived.id)).statusCode).toBe(404);
  });

  it("needs a session and a well-formed id", async () => {
    const file = await seed({});
    expect((await get(undefined, file.id)).statusCode).toBe(401);
    expect((await get(admin, "not-a-uuid")).statusCode).toBe(400);
  });
});
