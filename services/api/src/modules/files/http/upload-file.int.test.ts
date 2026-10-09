import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { createTestApp, signIn, testConfig, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { emlBytes, msgBytes, pdfBytes, pngBytes, uploadFile } from "../testing.js";

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
});
