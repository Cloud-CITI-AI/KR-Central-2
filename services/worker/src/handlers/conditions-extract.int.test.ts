import { ConditionsExtractResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext, insertFile } from "../../test/files.js";
import { makePdf } from "../../test/pdf.js";
import type { TaskError } from "../errors.js";
import { createParser, type Parser } from "../parsing/isolate.js";
import { conditionsExtractHandler } from "./conditions-extract.js";

const NOW = new Date("2026-04-01T02:00:00.000Z");
const LETTER = [
  ["Western Australian Planning Commission", "16 March 2026", "Approval is valid for two years.", "Conditions"],
  [
    "1. Power supply to each lot. (Western Power)",
    "2. Sewer connection required.",
    "3. Crossover to the verge. (City of Stirling)",
  ],
];
let db: Db;
let jobId: string;
const storage = createMemoryStorage();
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
  jobId = await insertJob(db);
  await db.updateTable("jobs").set({ outcome_date: "2026-06-14" }).where("id", "=", jobId).execute();
});

async function letter(pages: string[][] = LETTER, o: { name?: string; scanStatus?: "clean" | "pending" } = {}) {
  return insertFile(db, storage, jobId, {
    bytes: await makePdf(pages),
    name: o.name ?? "Decision Letter.pdf",
    scanStatus: o.scanStatus ?? "clean",
  });
}

async function extract(fileId: string, o: { replaceExisting?: boolean; parser?: Parser; again?: boolean } = {}) {
  const op = await enqueue(db, jobId, "conditions.extract", { fileId, replaceExisting: o.replaceExisting ?? false });
  const handler = conditionsExtractHandler({
    db,
    storage,
    parser: o.parser ?? createParser(),
    clock: { now: () => NOW },
    config: { UPLOAD_MAX_BYTES: 10 * 1024 * 1024, PDF_MAX_PAGES: 60 },
  });
  const ctx = handlerContext(op);
  const run = () =>
    handler.run(ctx).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error: error as TaskError }),
    );
  const first = await run();
  const last = o.again ? await run() : first;
  // whatever is stored as operations.result must be the contract's shape, with nothing extra
  if (last.result !== undefined) expect(ConditionsExtractResult.parse(last.result)).toEqual(last.result);
  return { op, ...last };
}

const current = () =>
  db
    .selectFrom("conditions")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .orderBy("condition_number")
    .execute();
const job = () => db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirstOrThrow();

const never = (): never => {
  throw new Error("no rows");
};

async function oldConditions() {
  const rows = await db
    .insertInto("conditions")
    .values(
      [1, 2].map((n) => ({
        job_id: jobId,
        condition_number: n,
        text: `Old ${n}`,
        agency: "WAPC" as const,
        is_cleared: true,
      })),
    )
    .returning("id")
    .execute();
  const evidence = await insertFile(db, storage, jobId, {
    conditionId: (rows[0] ?? never()).id,
    kind: "image",
    name: "photo.png",
  });
  return { ids: rows.map((r) => r.id), evidence };
}

describe("conditions.extract", () => {
  it("stores the conditions and sets the approval dates and the source, never the outcome date", async () => {
    const file = await letter();
    const { op, result, error } = await extract(file.id);
    expect(error).toBeUndefined();
    expect(result).toEqual({
      conditionsCount: 3,
      guessedNumbers: [2],
      approvalDate: "2026-03-16",
      approvalExpiry: "2028-03-16",
      message: "Check the agency for condition 2 – no agency was named in brackets, so it was guessed.",
    });
    expect(
      (await current()).map((c) => [c.condition_number, c.agency, c.agency_guessed, c.extraction_id, c.is_cleared]),
    ).toEqual([
      [1, "Western Power", false, op.id, false],
      [2, "Water Corporation", true, op.id, false],
      [3, "Local Government", false, op.id, false],
    ]);
    expect(await job()).toMatchObject({
      approval_date: "2026-03-16",
      approval_expiry: "2028-03-16",
      outcome_date: "2026-06-14",
      conditions_source_file_id: file.id,
      conditions_extracted_at: NOW,
      version: 2,
    });
    const audit = await db.selectFrom("audit_events").selectAll().where("job_id", "=", jobId).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: "system", action: "conditions.extracted", entity_id: op.id });
    expect(audit[0]?.changes).toMatchObject({
      conditionsCount: { from: 0, to: 3 },
      approvalDate: { from: null, to: "2026-03-16" },
    });
  });

  it("replaces existing conditions together with their evidence when asked to", async () => {
    const old = await oldConditions();
    const { result } = await extract((await letter()).id, { replaceExisting: true });
    expect((result as { conditionsCount: number }).conditionsCount).toBe(3);
    expect((await current()).map((c) => c.text)).not.toContain("Old 1");
    const superseded = await db
      .selectFrom("conditions")
      .select("id")
      .where("job_id", "=", jobId)
      .where("superseded_at", "is not", null)
      .execute();
    expect(superseded.map((r) => r.id).sort()).toEqual([...old.ids].sort());
    const evidence = await db
      .selectFrom("files")
      .select("deleted_at")
      .where("id", "=", old.evidence.id)
      .executeTakeFirstOrThrow();
    expect(evidence.deleted_at).toEqual(NOW);
  });

  it("does not replace existing conditions unless asked, and then changes nothing", async () => {
    await oldConditions();
    const before = await job();
    const { error } = await extract((await letter()).id);
    expect(error).toMatchObject({ code: "replace_required", retryable: false });
    expect((await current()).map((c) => c.text)).toEqual(["Old 1", "Old 2"]);
    expect(await job()).toEqual(before);
  });

  it("rolls everything back when storing fails halfway", async () => {
    await oldConditions();
    const before = await job();
    const clash: Parser = {
      run: () =>
        Promise.resolve({
          conditions: [1, 1].map((number) => ({ number, text: "Same", agency: "WAPC" as const, agencyGuessed: false })),
          dates: { approvalDate: "2026-03-16", approvalExpiry: null },
        } as never),
    };
    const { error } = await extract((await letter()).id, { replaceExisting: true, parser: clash });
    expect(error).toBeDefined();
    expect((await current()).map((c) => c.text)).toEqual(["Old 1", "Old 2"]);
    expect(await job()).toEqual(before);
  });

  it("applies a re-run of the same operation only once", async () => {
    const { result } = await extract((await letter()).id, { again: true });
    expect((result as { conditionsCount: number }).conditionsCount).toBe(3);
    expect(await current()).toHaveLength(3);
    expect((await job()).version).toBe(2);
  });

  it("with no numbered conditions keeps the existing ones and the source, but still saves the dates found", async () => {
    await oldConditions();
    const { result } = await extract(
      (await letter([["16 March 2026", "A letter with no conditions heading."]], { name: "Decision.pdf" })).id,
      { replaceExisting: true },
    );
    expect(result).toMatchObject({ conditionsCount: 0, approvalDate: "2026-03-16", approvalExpiry: null });
    expect((result as { message: string }).message).toMatch(/^No numbered conditions were found/);
    expect((await current()).map((c) => c.text)).toEqual(["Old 1", "Old 2"]);
    expect(await job()).toMatchObject({
      approval_date: "2026-03-16",
      conditions_source_file_id: null,
      conditions_extracted_at: null,
    });
  });

  it("keeps dates already on the job when the letter has none", async () => {
    await db
      .updateTable("jobs")
      .set({ approval_date: "2025-01-02", approval_expiry: "2027-01-02" })
      .where("id", "=", jobId)
      .execute();
    await extract((await letter([["Conditions", "1. Power supply. (Western Power)"]])).id);
    expect(await job()).toMatchObject({ approval_date: "2025-01-02", approval_expiry: "2027-01-02" });
  });

  it("fails clearly for a file that is not a readable clean Decision Letter in the 5.0 box", async () => {
    const wrongSlot = await insertFile(db, storage, jobId, {
      bytes: await makePdf(LETTER),
      checkpointKey: "i4_2",
      slot: "conformance",
    });
    const pending = await letter(LETTER, { scanStatus: "pending" });
    const deleted = await letter();
    await db.updateTable("files").set({ deleted_at: NOW }).where("id", "=", deleted.id).execute();
    for (const f of [wrongSlot, pending, deleted]) expect((await extract(f.id)).error?.code).toBe("file_unavailable");
    const notPdf = await insertFile(db, storage, jobId, { bytes: "just text", scanStatus: "clean" });
    expect((await extract(notPdf.id)).error).toMatchObject({ code: "not_a_pdf", retryable: false });
    expect(await current()).toHaveLength(0);
  });

  it("fails for an archived job", async () => {
    const file = await letter();
    await db.updateTable("jobs").set({ deleted_at: NOW }).where("id", "=", jobId).execute();
    expect((await extract(file.id)).error?.code).toBe("job_unavailable");
  });
});
