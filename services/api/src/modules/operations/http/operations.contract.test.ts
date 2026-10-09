/** getOperation answers exactly what packages/contracts/openapi.yaml declares, for every status an operation can have. */
import { enqueueOperation, type OperationStatusValue } from "@kr/db";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  schemaViolations,
  createTestApp,
  signIn,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { registeredOperations } from "../../../app.js";
import { operationsModule } from "../index.js";

function conforms(res: LightMyRequestResponse): void {
  const problem = res.statusCode >= 400;
  const contentType = problem ? "application/problem+json" : "application/json";
  expect(contractViolations("getOperation", res.statusCode, res.json(), contentType), `${res.statusCode}`).toEqual([]);
  expect(res.headers["content-type"]).toContain(contentType);
}

describe("operations module contract", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn, outsider: SignedIn;
  let jobId: string;
  const get = (who: SignedIn | undefined, id: string) =>
    apiRequest(t, { url: `/v1/operations/${id}`, ...(who ? { as: who } : {}) });
  const make = async (
    type: "conditions.extract" | "conformance.read" | "email.parse" | "file.scan",
    status: OperationStatusValue,
    result?: unknown,
    error?: { code: string; message: string },
  ) => {
    const op = await enqueueOperation(t.db, { jobId, type, payload: {}, createdBy: null });
    await t.db
      .updateTable("operations")
      .set({
        status,
        ...(result === undefined ? {} : { result: JSON.stringify(result) }),
        ...(error ? { error_code: error.code, error_message: error.message } : {}),
        ...(status === "succeeded" || status === "failed" ? { completed_at: t.deps.clock.now() } : {}),
      })
      .where("id", "=", op.id)
      .execute();
    return op.id;
  };

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
    outsider = await signIn(t, await f.makeUser({ role: "external" }));
    jobId = (await f.makeJob()).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers getOperation through defineRoute", () => {
    expect(registeredOperations(t.app)).toContain("getOperation");
    expect(operationsModule.operations).toEqual(["getOperation"]);
  });

  it("200 for queued, running, succeeded (both result shapes), failed and the email and scan types", async () => {
    const extract = {
      conditionsCount: 0,
      guessedNumbers: [],
      approvalDate: null,
      approvalExpiry: null,
      message: "No numbered conditions were found in this PDF.",
    };
    const read = {
      found: false,
      date: null,
      method: null,
      stampText: null,
      message: "No stamped date could be found.",
    };
    const ids = [
      await make("conditions.extract", "queued"),
      await make("conformance.read", "running"),
      await make("conditions.extract", "succeeded", extract),
      await make("conformance.read", "succeeded", read),
      await make("conditions.extract", "failed", undefined, { code: "unreadable_pdf", message: "internal detail" }),
      await make("email.parse", "succeeded", { parsed: true }),
      await make("file.scan", "queued"),
    ];
    for (const id of ids) {
      const res = await get(staff, id);
      expect(res.statusCode, id).toBe(200);
      conforms(res);
    }
  });

  it("401 and 404 (unknown id, a job the caller cannot see) are the declared problem+json", async () => {
    const id = await make("conditions.extract", "queued");
    for (const [status, who, target] of [
      [401, undefined, id],
      [404, outsider, id],
      [404, staff, "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11"],
    ] as const) {
      const res = await get(who, target);
      expect(res.statusCode, String(status)).toBe(status);
      conforms(res);
    }
  });

  // The registry declares no 400 for getOperation (a path id that is not a UUID); the body is still the Problem schema.
  it("a path id that is not a UUID is a 400 Problem", async () => {
    const res = await get(staff, "not-a-uuid");
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(schemaViolations("Problem", res.json())).toEqual([]);
  });
});
