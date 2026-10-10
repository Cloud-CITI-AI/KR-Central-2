import { StorageUnavailableError } from "@kr/storage";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { pdfBytes, readZip, seedFile, textBytes } from "../testing.js";

describe("downloadJobPackage contents (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn;
  const download = (jobId: string, who: SignedIn = staff) =>
    apiRequest(t, { url: `/v1/jobs/${jobId}/package`, as: who });
  const entries = async (jobId: string) => readZip((await download(jobId)).rawPayload);

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
  });
  afterAll(async () => {
    await t.close();
  });

  it("an empty job still gives a zip with its Job summary.txt (the page disables the button, the API does not care)", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0001" });
    const zip = await entries(job.id);
    expect([...zip.keys()]).toHaveLength(1);
    expect([...zip.keys()][0]).toMatch(/\/Job summary\.txt$/);
  });

  it("suffixes duplicate names with ' (2)' and ' (3)' before the extension", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0002" });
    for (const name of ["Plan.pdf", "plan.PDF", "Plan.pdf"]) {
      await seedFile(t, f, { jobId: job.id, data: pdfBytes(40, name), name, checkpointKey: "i2_0", slot: "survey" });
    }
    const names = [...(await entries(job.id)).keys()].map((k) => k.split("/").pop());
    expect(names).toEqual(["Job summary.txt", "Plan.pdf", "plan (2).PDF", "Plan (3).pdf"]);
  });

  it("zips a text file stored under a dangerous extension as .txt", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0003A" });
    await seedFile(t, f, {
      jobId: job.id,
      data: textBytes("x"),
      name: "evil.vbe",
      kind: "text",
      contentType: "text/plain",
    });
    await seedFile(t, f, { jobId: job.id, data: pdfBytes(), name: "Plan.pdf" });
    const names = [...(await entries(job.id)).keys()].map((k) => k.split("/").pop());
    expect(names).toEqual(["Job summary.txt", "evil.vbe.txt", "Plan.pdf"]);
  });

  it("leaves out evidence of superseded conditions", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0003" });
    const old = await f.makeCondition({ jobId: job.id, number: 1, agency: "WAPC" });
    const current = await f.makeCondition({ jobId: job.id, number: 2, agency: "WAPC" });
    await seedFile(t, f, { jobId: job.id, data: pdfBytes(), name: "old.pdf", conditionId: old.id });
    await seedFile(t, f, { jobId: job.id, data: pdfBytes(), name: "new.pdf", conditionId: current.id });
    await t.db.updateTable("conditions").set({ superseded_at: new Date() }).where("id", "=", old.id).execute();
    const names = [...(await entries(job.id)).keys()].map((k) => k.split("/").slice(1).join("/"));
    expect(names).toEqual(["Job summary.txt", "07 WAPC/WAPC conditions/Condition 2 evidence/new.pdf"]);
  });

  it("Job summary.txt carries the job line, the download time, dates, stages, conditions and notes (spec 5.8)", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0004" });
    await t.db
      .updateTable("jobs")
      .set({
        address: "9 Sample Road, Testville",
        client_name: "Sample Developments Pty Ltd",
        subdivision_type: "Freehold",
        conformed_date: "2026-03-16",
        conformed_method: "manual",
        outcome_date: "2026-06-14",
      })
      .where("id", "=", job.id)
      .execute();
    await t.db
      .updateTable("checkpoint_states")
      .set({ status: "completed" })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i2_0")
      .execute();
    const condition = await f.makeCondition({ jobId: job.id, number: 1, agency: "Water Corporation" });
    await t.db
      .updateTable("conditions")
      .set({ kr_comment: "Agreement requested", client_comment: "Signed copy sent", text: "Water agreement." })
      .where("id", "=", condition.id)
      .execute();
    await t.db
      .insertInto("job_notes")
      .values({
        job_id: job.id,
        author_id: staff.user.id,
        body: "Call the client\nabout the lot",
        audience: "client",
        created_at: new Date("2026-03-02T01:00:00Z"),
      })
      .execute();
    const zip = await entries(job.id);
    const summary = [...zip.entries()].find(([k]) => k.endsWith("Job summary.txt"))?.[1].toString("utf8") ?? "";
    const lines = summary.split("\r\n");
    expect(lines.slice(0, 6)).toEqual([
      "PC-0004 – 9 Sample Road, Testville – Sample Developments Pty Ltd (Freehold)",
      "Downloaded 2 Mar 2026, 9:00 am",
      "",
      "Conformed date: Mon, 16 Mar 2026",
      "WAPC outcome date: Sun, 14 Jun 2026",
      "",
    ]);
    expect(lines).toContain("  2.0   Completed      Site Feature Survey");
    expect(lines).toContain("03 WESTERN POWER  (not required – no conditions in the Decision Letter)");
    expect(lines).toContain("  1   Open     Water Corporation  –  Water agreement.");
    expect(lines).toContain("        KR comment: Agreement requested");
    expect(lines).toContain("        Client comment: Signed copy sent");
    expect(lines.slice(lines.indexOf("JOB NOTES"))).toEqual([
      "JOB NOTES",
      "  2 Mar 2026, 9:00 am  (for client)",
      "    Call the client",
      "    about the lot",
    ]);
  });

  it("writes one job.package_downloaded audit row with the number of files", async () => {
    const job = await f.makeJob({ jobNumber: "PC-0005" });
    await seedFile(t, f, { jobId: job.id, data: pdfBytes(), checkpointKey: "i2_0", slot: "survey" });
    await download(job.id);
    const audits = await t.db.selectFrom("audit_events").selectAll().where("job_id", "=", job.id).execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "job.package_downloaded",
      entity_type: "job",
      actor_user_id: staff.user.id,
    });
    expect(audits[0]?.changes).toEqual({ fileCount: { from: null, to: 1 } });
  });

  describe("a file whose stored object is gone", () => {
    it("is skipped and named in Job summary.txt, the rest of the zip is complete, and the audit row counts both", async () => {
      const job = await f.makeJob({ jobNumber: "PC-0008" });
      await seedFile(t, f, {
        jobId: job.id,
        data: pdfBytes(50, "keep"),
        name: "Keep.pdf",
        checkpointKey: "i2_0",
        slot: "survey",
      });
      const lost = await seedFile(t, f, {
        jobId: job.id,
        data: pdfBytes(50, "lost"),
        name: "Lost.pdf",
        checkpointKey: "i3_0p",
        slot: "proposal",
      });
      await seedFile(t, f, {
        jobId: job.id,
        data: pdfBytes(50, "last"),
        name: "Last.pdf",
        checkpointKey: "i11_0",
        slot: "photos",
      });
      await t.storage.delete(lost.storage_key);
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await download(job.id);
        expect(res.statusCode).toBe(200);
        const zip = await readZip(res.rawPayload);
        expect([...zip.keys()].map((k) => k.split("/").pop())).toEqual(["Job summary.txt", "Keep.pdf", "Last.pdf"]);
        const summary =
          zip
            .get([...zip.keys()][0] ?? "")
            ?.toString("utf8")
            .split("\r\n") ?? [];
        expect(summary.slice(3, 7)).toEqual([
          "FILES NOT INCLUDED (1)",
          "  These files could not be read from storage, so they are not in this zip. Ask KR Surveys to restore them.",
          "  02 WAPC Approval/3.0 WAPC Proposal/Lost.pdf",
          "",
        ]);
      }
      expect(t.logLines()).toContainEqual(
        expect.objectContaining({ event: "file_object_missing", fileId: lost.id, inPackage: true }),
      );
      expect(t.logLines().filter((l) => l.event === "package_failed")).toEqual([]);
      const audits = await t.db.selectFrom("audit_events").selectAll().where("job_id", "=", job.id).execute();
      expect(audits.map((a) => a.changes)).toEqual([
        { fileCount: { from: null, to: 2 }, missingCount: { from: null, to: 1 } },
        { fileCount: { from: null, to: 2 }, missingCount: { from: null, to: 1 } },
      ]);
    });

    it("every object missing still gives a zip with its summary", async () => {
      const job = await f.makeJob({ jobNumber: "PC-0009" });
      const only = await seedFile(t, f, {
        jobId: job.id,
        data: pdfBytes(),
        name: "Only.pdf",
        checkpointKey: "i2_0",
        slot: "survey",
      });
      await t.storage.delete(only.storage_key);
      const zip = await readZip((await download(job.id)).rawPayload);
      expect([...zip.keys()].map((k) => k.split("/").pop())).toEqual(["Job summary.txt"]);
    });

    it("answers 503 and writes no audit row when storage cannot be listed", async () => {
      const base = createMemoryStorage();
      const local = await createTestApp({
        storage: {
          ...base,
          list: () => ({
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.reject(new StorageUnavailableError(new Error("down"))),
            }),
          }),
        },
      });
      const lf = createFactories(local.db, 503);
      const user = await signIn(local, await lf.makeUser({ role: "staff" }));
      const job = await lf.makeJob({ jobNumber: "PC-0010" });
      const res = await apiRequest(local, { url: `/v1/jobs/${job.id}/package`, as: user });
      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:storage-unavailable" });
      expect(await local.db.selectFrom("audit_events").select("id").where("job_id", "=", job.id).execute()).toEqual([]);
      await local.close();
    });
  });

  describe("streaming", () => {
    it("sends the first entry before the next file has been read, and the complete zip once all are", async () => {
      const base = createMemoryStorage();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reads: string[] = [];
      const local = await createTestApp({
        storage: {
          ...base,
          get: async (key, range) => {
            reads.push(key);
            await gate;
            return base.get(key, range);
          },
        },
      });
      const lf = createFactories(local.db, 501);
      const user = await signIn(local, await lf.makeUser({ role: "staff" }));
      const job = await lf.makeJob({ jobNumber: "PC-0006" });
      const seeded = { db: local.db, storage: base };
      await seedFile(seeded, lf, {
        jobId: job.id,
        data: pdfBytes(40, "a"),
        name: "a.pdf",
        checkpointKey: "i2_0",
        slot: "survey",
      });
      await seedFile(seeded, lf, {
        jobId: job.id,
        data: pdfBytes(40, "b"),
        name: "b.pdf",
        checkpointKey: "i2_0",
        slot: "survey",
      });
      await local.app.listen({ port: 0, host: "127.0.0.1" });
      const address = local.app.server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/v1/jobs/${job.id}/package`, {
        headers: { cookie: user.cookie },
      });
      expect(res.status).toBe(200);
      const reader = (res.body ?? new ReadableStream<Uint8Array>()).getReader();
      const first = await reader.read();
      expect(first.value?.length).toBeGreaterThan(0);
      expect(reads).toEqual([]); // the summary was already on the wire, no object had been opened
      release();
      const chunks: Buffer[] = first.value ? [Buffer.from(first.value)] : [];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(Buffer.from(next.value as Uint8Array));
      }
      expect([...(await readZip(Buffer.concat(chunks))).keys()].map((k) => k.split("/").pop())).toEqual([
        "Job summary.txt",
        "a.pdf",
        "b.pdf",
      ]);
      await local.close();
    });

    it("destroys the download, and logs it, when an object cannot be read: no zip that silently lacks a file", async () => {
      const base = createMemoryStorage();
      const local = await createTestApp({ storage: { ...base, get: () => Promise.reject(new Error("bucket down")) } });
      const lf = createFactories(local.db, 502);
      const user = await signIn(local, await lf.makeUser({ role: "staff" }));
      const job = await lf.makeJob({ jobNumber: "PC-0007" });
      await seedFile({ db: local.db, storage: base }, lf, {
        jobId: job.id,
        data: pdfBytes(),
        checkpointKey: "i2_0",
        slot: "survey",
      });
      await expect(apiRequest(local, { url: `/v1/jobs/${job.id}/package`, as: user })).rejects.toThrow(
        "response destroyed before completion",
      );
      expect(local.logLines()).toContainEqual(expect.objectContaining({ event: "package_failed" }));
      await local.close();
    });
  });
});
