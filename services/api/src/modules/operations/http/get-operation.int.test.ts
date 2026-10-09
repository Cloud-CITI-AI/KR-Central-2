import type { Operation } from "@kr/contracts";
import { enqueueOperation, type OperationRow, type OperationTypeValue } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

describe("getOperation (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const make = async (
    type: OperationTypeValue = "conditions.extract",
    set: Partial<Pick<OperationRow, "status" | "error_code" | "error_message" | "completed_at">> & {
      result?: unknown;
    } = {},
    forJob: string = jobId,
  ) => {
    const op = await enqueueOperation(t.db, {
      jobId: forJob,
      type,
      payload: { fileId: "x" },
      createdBy: staff.user.id,
    });
    if (Object.keys(set).length === 0) return op;
    const { result, ...columns } = set;
    return t.db
      .updateTable("operations")
      .set({ ...columns, ...(result === undefined ? {} : { result: JSON.stringify(result) }) })
      .where("id", "=", op.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  };
  const get = (who: SignedIn | undefined, id: string) =>
    apiRequest(t, { url: `/v1/operations/${id}`, ...(who ? { as: who } : {}) });
  const done = new Date("2026-03-02T01:00:05Z");

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [staff, client, architect, outsider] = [
      await as("staff"),
      await as("external"),
      await as("external"),
      await as("external"),
    ];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("a queued or running operation answers 200 with Retry-After: 2", async () => {
    for (const status of ["queued", "running"] as const) {
      const op = await make("conditions.extract", { status });
      const res = await get(staff, op.id);
      expect(res.statusCode).toBe(200);
      expect(res.headers["retry-after"]).toBe("2");
      expect(res.json<Operation>()).toEqual({
        id: op.id,
        jobId,
        type: "conditions.extract",
        status,
        createdAt: op.created_at.toISOString(),
        completedAt: null,
        result: null,
        error: null,
      });
    }
  });

  it("a succeeded operation returns its result and no Retry-After", async () => {
    const result = {
      conditionsCount: 3,
      guessedNumbers: [2],
      approvalDate: "2026-01-05",
      approvalExpiry: "2028-01-05",
      message: "Check the agency for condition 2 – no agency was named in brackets, so it was guessed.",
    };
    const op = await make("conditions.extract", { status: "succeeded", result, completed_at: done });
    const res = await get(staff, op.id);
    expect(res.headers["retry-after"]).toBeUndefined();
    expect(res.json<Operation>()).toMatchObject({
      status: "succeeded",
      completedAt: done.toISOString(),
      result,
      error: null,
    });
    const read = {
      found: true,
      date: "2026-03-16",
      method: "file_name",
      stampText: null,
      message: "Taken from the file name: 16 Mar 2026.",
    };
    const conform = await make("conformance.read", { status: "succeeded", result: read, completed_at: done });
    expect((await get(staff, conform.id)).json<Operation>()).toMatchObject({ type: "conformance.read", result: read });
  });

  it("shows only user-safe failures: known codes use the API's text, internal text is replaced", async () => {
    const cases: [string, string | null, string][] = [
      [
        "unreadable_pdf",
        "pdf.js: InvalidPDFException at /app/node_modules/pdfjs/x.js:12:3",
        "The PDF could not be read. It may be damaged or a scanned image.",
      ],
      [
        "handler_crashed",
        "Error: connect ECONNREFUSED 10.1.2.3:5432\n    at connect (/app/dist/db.js:1:1)",
        "The task could not be completed. Try again, or contact KR Surveys if it keeps failing.",
      ],
      ["no_text", "No readable text was found in this PDF.", "No readable text was found in this PDF."],
      ["timeout", null, "Reading the document took too long. Try again."],
    ];
    for (const [code, message, shown] of cases) {
      const op = await make("conditions.extract", {
        status: "failed",
        error_code: code,
        error_message: message,
        completed_at: done,
      });
      const res = await get(staff, op.id);
      expect(res.json<Operation>(), code).toMatchObject({
        status: "failed",
        result: null,
        error: { code, message: shown },
      });
      expect(res.body).not.toMatch(/ECONNREFUSED|node_modules|\/app\//);
    }
  });

  it("drops a stored result that does not match the contract, and never returns a result for scan or email operations", async () => {
    const bad = await make("conformance.read", {
      status: "succeeded",
      result: { date: "yesterday" },
      completed_at: done,
    });
    expect((await get(staff, bad.id)).json<Operation>()).toMatchObject({ status: "succeeded", result: null });
    expect(t.logLines().some((l) => l.event === "operation_result_unreadable" && l.operationId === bad.id)).toBe(true);
    const scan = await make("file.scan", { status: "succeeded", result: { scanned: true }, completed_at: done });
    expect((await get(staff, scan.id)).json<Operation>()).toMatchObject({ type: "file.scan", result: null });
  });

  it("anyone who can see the job may poll its operation, including a client and an architect", async () => {
    const op = await make();
    for (const who of [staff, client, architect]) expect((await get(who, op.id)).statusCode).toBe(200);
  });

  it("answers 404 for an unknown id, a job the caller cannot see, an archived job and a revoked grant", async () => {
    const op = await make();
    expect((await get(outsider, op.id)).statusCode).toBe(404);
    expect((await get(staff, "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11")).statusCode).toBe(404);
    const archived = await f.makeJob({ deletedAt: t.deps.clock.now() });
    expect((await get(staff, (await make("conditions.extract", {}, archived.id)).id)).statusCode).toBe(404);
    const other = await f.makeJob();
    const grant = await f.makeGrant({ jobId: other.id, userId: outsider.user.id, role: "client" });
    const otherOp = await make("conditions.extract", {}, other.id);
    expect((await get(outsider, otherOp.id)).statusCode).toBe(200);
    await t.db
      .updateTable("access_grants")
      .set({ status: "revoked", revoked_at: t.deps.clock.now() })
      .where("id", "=", grant.id)
      .execute();
    expect((await get(outsider, otherOp.id)).statusCode).toBe(404);
  });

  it("is 401 without a session and 400 for an id that is not a UUID", async () => {
    const op = await make();
    expect((await get(undefined, op.id)).statusCode).toBe(401);
    expect((await get(staff, "not-a-uuid")).statusCode).toBe(400);
  });
});
