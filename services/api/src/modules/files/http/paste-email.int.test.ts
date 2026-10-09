import type { FileMeta } from "@kr/contracts";
import { createMemoryStorage } from "@kr/storage/testing";
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

const TEXT = "Query about lot 12\nPlease confirm the setback before Friday.\n";

describe("pasteEmail (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const paste = (who: SignedIn | undefined, body: unknown, id = jobId, headers: Record<string, string> = {}) =>
    apiRequest(t, { method: "POST", url: `/v1/jobs/${id}/emails`, ...(who ? { as: who } : {}), body, headers });

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

  it("stores the text as an email file in 4.3 with an already parsed email record", async () => {
    const res = await paste(staff, { text: TEXT });
    expect(res.statusCode).toBe(201);
    const meta = res.json<FileMeta>();
    expect(res.headers.location).toBe(`/v1/files/${meta.id}`);
    expect(meta).toMatchObject({
      jobId,
      checkpointKey: "i4_3",
      slot: "email",
      conditionId: null,
      name: "Query about lot 12.txt",
      kind: "email",
      contentType: "text/plain",
      scanStatus: "pending",
      uploadedBy: { id: staff.user.id },
      canDelete: true,
      email: {
        parseStatus: "parsed",
        subject: "Query about lot 12",
        from: "Pasted text",
        to: null,
        cc: null,
        sentAt: t.deps.clock.now().toISOString(),
        isPasted: true,
      },
    });
    const row = await t.db.selectFrom("files").selectAll().where("id", "=", meta.id).executeTakeFirstOrThrow();
    const record = await t.db
      .selectFrom("email_messages")
      .selectAll()
      .where("file_id", "=", meta.id)
      .executeTakeFirstOrThrow();
    expect(record).toMatchObject({ parse_status: "parsed", is_pasted: true, body_text: TEXT.trim() });
    const object = await t.storage.get(row.storage_key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const stored = Buffer.concat(chunks).toString("utf8");
    expect(stored).toContain("Subject: Query about lot 12\nFrom: Pasted text\nDate: 2 Mar 2026, 9:00 am\n");
    expect(stored.endsWith(TEXT.trim())).toBe(true);
    expect(row).toMatchObject({ size_bytes: String(Buffer.byteLength(stored)), content_type: "text/plain" });
  });

  it("is scanned like any file and is never queued for parsing again", async () => {
    const meta = (await paste(admin, { text: TEXT })).json<FileMeta>();
    const ops = await t.db.selectFrom("operations").selectAll().where("job_id", "=", jobId).execute();
    const mine = ops.filter((o) => (o.payload as { fileId?: string }).fileId === meta.id);
    expect(mine.map((o) => o.type)).toEqual(["file.scan"]);
  });

  it("with MALWARE_SCAN_MODE=disabled the file is skipped and nothing is queued", async () => {
    const local = await createTestApp({ config: testConfig({ MALWARE_SCAN_MODE: "disabled" }) });
    const lf = createFactories(local.db, 401);
    const user = await signIn(local, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await apiRequest(local, {
      method: "POST",
      url: `/v1/jobs/${job.id}/emails`,
      as: user,
      body: { text: TEXT },
    });
    expect(res.json<FileMeta>().scanStatus).toBe("skipped");
    expect(await local.db.selectFrom("operations").select("id").where("job_id", "=", job.id).execute()).toEqual([]);
    await local.close();
  });

  it("writes an email.pasted audit row with the length of the text, never the text", async () => {
    const meta = (await paste(krAdmin, { text: "Secret subject line\nand a body" })).json<FileMeta>();
    const audits = await t.db.selectFrom("audit_events").selectAll().where("entity_id", "=", meta.id).execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "email.pasted",
      entity_type: "file",
      job_id: jobId,
      actor_user_id: krAdmin.user.id,
    });
    expect(audits[0]?.changes).toEqual({ textLength: { from: null, to: 30 } });
    expect(JSON.stringify(audits[0])).not.toContain("Secret");
  });

  it("is open to staff only (emails.add): clients and architects get 403, others 404, nothing is stored", async () => {
    const before = (await t.db.selectFrom("files").select("id").where("job_id", "=", jobId).execute()).length;
    expect((await paste(client, { text: TEXT })).statusCode).toBe(403);
    expect((await paste(architect, { text: TEXT })).statusCode).toBe(403);
    expect((await paste(outsider, { text: TEXT })).statusCode).toBe(404);
    expect((await paste(undefined, { text: TEXT })).statusCode).toBe(401);
    expect(
      (
        await apiRequest(t, {
          method: "POST",
          url: `/v1/jobs/${jobId}/emails`,
          as: staff,
          csrf: null,
          body: { text: TEXT },
        })
      ).statusCode,
    ).toBe(403);
    const archived = await f.makeJob({ deletedAt: new Date() });
    expect((await paste(admin, { text: TEXT }, archived.id)).statusCode).toBe(404);
    expect((await t.db.selectFrom("files").select("id").where("job_id", "=", jobId).execute()).length).toBe(before);
  });

  it("validates the text: required, at most 100,000 characters, nothing else in the body", async () => {
    for (const body of [
      {},
      { text: "" },
      { text: "  \n " },
      { text: 5 },
      { text: TEXT, extra: 1 },
      { text: "x".repeat(100_001) },
    ]) {
      expect((await paste(staff, body)).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await paste(staff, { text: "x".repeat(100_000) })).statusCode).toBe(201);
  });

  it("honours Idempotency-Key: a repeat returns the first file and stores one object", async () => {
    const send = () => paste(staff, { text: "Same request\nbody" }, jobId, { "idempotency-key": "paste-key-0001" });
    const [first, second] = [await send(), await send()];
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json<FileMeta>().id).toBe(first.json<FileMeta>().id);
    const copies = await t.db
      .selectFrom("email_messages")
      .select("file_id")
      .where("body_text", "=", "Same request\nbody")
      .execute();
    expect(copies).toHaveLength(1);
  });

  it("a storage failure is a 500 problem without a file row", async () => {
    const failing = await createTestApp({
      storage: { ...createMemoryStorage(), put: () => Promise.reject(new Error("bucket down")) },
    });
    const lf = createFactories(failing.db, 402);
    const user = await signIn(failing, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const res = await apiRequest(failing, {
      method: "POST",
      url: `/v1/jobs/${job.id}/emails`,
      as: user,
      body: { text: TEXT },
    });
    expect(res.statusCode).toBe(500);
    expect(await failing.db.selectFrom("files").select("id").where("job_id", "=", job.id).execute()).toEqual([]);
    await failing.close();
  });
});
