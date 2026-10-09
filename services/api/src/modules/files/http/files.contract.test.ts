/** Every files-module operation answers exactly what packages/contracts/openapi.yaml declares, success and error. */
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  createTestApp,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { registeredOperations } from "../../../app.js";
import { filesModule } from "../index.js";
import { emlBytes, pdfBytes, pngBytes, readZip, seedFile, uploadFile } from "../testing.js";

const MISSING = "4a1f0f3e-5b0d-4c1c-8f75-6a9c2d7d9e10";

/** The body is valid for (operation, status): JSON for success, problem+json from 400 up. */
function conforms(operationId: string, res: LightMyRequestResponse): void {
  const problem = res.statusCode >= 400;
  const contentType = problem ? "application/problem+json" : "application/json";
  expect(
    contractViolations(operationId, res.statusCode, res.json(), contentType),
    `${operationId} ${res.statusCode}`,
  ).toEqual([]);
  expect(res.headers["content-type"]).toContain(contentType);
}

describe("files module contract", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const send = (o: {
    method?: "GET" | "POST" | "DELETE";
    url: string;
    as?: SignedIn;
    body?: unknown;
    headers?: Record<string, string>;
  }) =>
    apiRequest(t, {
      method: o.method ?? "GET",
      url: o.url,
      ...(o.as ? { as: o.as } : {}),
      ...(o.body === undefined ? {} : { body: o.body }),
      ...(o.headers ? { headers: o.headers } : {}),
    });
  const upload = (who: SignedIn | undefined, fields: Record<string, string>, name = "a.pdf", data = pdfBytes()) =>
    uploadFile(t, { jobId, ...(who ? { as: who } : {}), fields, file: { name, data } });
  const SLOT = { checkpointKey: "i2_0", slot: "survey" };

  beforeAll(async () => {
    t = await createTestApp({
      config: testConfig({ UPLOAD_MAX_BYTES: "2048", RATE_LIMIT_UPLOADS_PER_MINUTE: "1000" }),
    });
    f = createFactories(t.db);
    [admin, staff, client, architect, outsider] = [
      await as("admin"),
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

  it("registers all six files operations through defineRoute", () => {
    for (const id of filesModule.operations) expect(registeredOperations(t.app), id).toContain(id);
    expect(filesModule.operations).toHaveLength(6);
  });

  it("uploadFile: 201 UploadResult, 400, 401, 403, 404, 413 and 415 as declared", async () => {
    const ok = await upload(staff, SLOT);
    expect(ok.statusCode).toBe(201);
    conforms("uploadFile", ok);
    const email = await upload(staff, { checkpointKey: "i4_3", slot: "email" }, "q.eml", emlBytes());
    expect(email.statusCode).toBe(201);
    conforms("uploadFile", email);
    const cases: [number, LightMyRequestResponse][] = [
      [400, await upload(staff, { checkpointKey: "i2_0" })],
      [401, await upload(undefined, SLOT)],
      [403, await upload(client, SLOT)],
      [404, await upload(outsider, SLOT)],
      [413, await upload(staff, SLOT, "big.pdf", pdfBytes(3000))],
      [415, await upload(staff, SLOT, "plan.pdf", Buffer.from("<html></html>"))],
    ];
    for (const [status, res] of cases) {
      expect(res.statusCode).toBe(status);
      conforms("uploadFile", res);
    }
  });

  it("uploadFile: 429 as declared when the upload limit is exceeded", async () => {
    const limited = await createTestApp({ config: testConfig({ RATE_LIMIT_UPLOADS_PER_MINUTE: "1" }) });
    const lf = createFactories(limited.db, 601);
    const user = await signIn(limited, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const go = () =>
      uploadFile(limited, { jobId: job.id, as: user, fields: SLOT, file: { name: "a.pdf", data: pdfBytes() } });
    await go();
    const res = await go();
    expect(res.statusCode).toBe(429);
    conforms("uploadFile", res);
    await limited.close();
  });

  it("getFile: 200 FileMeta, 400, 401 and 404", async () => {
    const file = await seedFile(t, f, { jobId, data: pdfBytes(), uploadedBy: staff.user.id });
    const ok = await send({ url: `/v1/files/${file.id}`, as: client });
    expect(ok.statusCode).toBe(200);
    conforms("getFile", ok);
    for (const [status, res] of [
      [400, await send({ url: "/v1/files/nope", as: admin })],
      [401, await send({ url: `/v1/files/${file.id}` })],
      [404, await send({ url: `/v1/files/${MISSING}`, as: admin })],
      [404, await send({ url: `/v1/files/${file.id}`, as: outsider })],
    ] as const) {
      expect(res.statusCode).toBe(status);
      conforms("getFile", res);
    }
    const email = await seedFile(t, f, {
      jobId,
      data: emlBytes(),
      kind: "email",
      contentType: "message/rfc822",
      checkpointKey: "i4_3",
      slot: "email",
    });
    await f.makeEmail(email.id);
    const withEmail = await send({ url: `/v1/files/${email.id}`, as: staff });
    conforms("getFile", withEmail);
    expect(withEmail.json<{ email: unknown }>().email).not.toBeNull();
  });

  it("getFileContent: 200 and 206 bytes, 400, 401, 404, 409 and 416 as declared", async () => {
    const data = pngBytes();
    const file = await seedFile(t, f, { jobId, data, kind: "image", contentType: "image/png", name: "a.png" });
    const ok = await send({ url: `/v1/files/${file.id}/content`, as: architect });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload).toEqual(data);
    const part = await send({ url: `/v1/files/${file.id}/content`, as: architect, headers: { range: "bytes=0-7" } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload).toEqual(data.subarray(0, 8));
    const pending = await seedFile(t, f, { jobId, data, scanStatus: "pending" });
    const infected = await seedFile(t, f, { jobId, data, scanStatus: "infected" });
    for (const [status, res] of [
      [401, await send({ url: `/v1/files/${file.id}/content` })],
      [404, await send({ url: `/v1/files/${MISSING}/content`, as: admin })],
      [409, await send({ url: `/v1/files/${pending.id}/content`, as: staff })],
      [409, await send({ url: `/v1/files/${infected.id}/content`, as: staff })],
    ] as const) {
      expect(res.statusCode).toBe(status);
      conforms("getFileContent", res);
    }
    const badQuery = await send({ url: `/v1/files/${file.id}/content?disposition=nope`, as: staff });
    expect(badQuery.statusCode).toBe(400);
    conforms("getFileContent", badQuery);
    const unsatisfiable = await send({
      url: `/v1/files/${file.id}/content`,
      as: staff,
      headers: { range: "bytes=999-" },
    });
    expect(unsatisfiable.statusCode).toBe(416);
    conforms("getFileContent", unsatisfiable);
    expect(unsatisfiable.headers["content-range"]).toBe(`bytes */${data.length}`);
  });

  it("deleteFile: 204, 401, 403, 404 as declared", async () => {
    const mine = await seedFile(t, f, { jobId, data: pdfBytes(), uploadedBy: architect.user.id });
    const theirs = await seedFile(t, f, { jobId, data: pdfBytes(), uploadedBy: staff.user.id });
    const gone = await send({ method: "DELETE", url: `/v1/files/${mine.id}`, as: architect });
    expect(gone.statusCode).toBe(204);
    expect(gone.body).toBe("");
    for (const [status, res] of [
      [401, await send({ method: "DELETE", url: `/v1/files/${theirs.id}` })],
      [403, await send({ method: "DELETE", url: `/v1/files/${theirs.id}`, as: architect })],
      [404, await send({ method: "DELETE", url: `/v1/files/${mine.id}`, as: admin })],
      [400, await send({ method: "DELETE", url: "/v1/files/nope", as: admin })],
    ] as const) {
      expect(res.statusCode).toBe(status);
      conforms("deleteFile", res);
    }
  });

  it("pasteEmail: 201 FileMeta, 400, 401, 403, 404 as declared", async () => {
    const url = `/v1/jobs/${jobId}/emails`;
    const ok = await send({ method: "POST", url, as: staff, body: { text: "Query\nbody" } });
    expect(ok.statusCode).toBe(201);
    conforms("pasteEmail", ok);
    for (const [status, res] of [
      [400, await send({ method: "POST", url, as: staff, body: { text: "  " } })],
      [401, await send({ method: "POST", url, body: { text: "x" } })],
      [403, await send({ method: "POST", url, as: client, body: { text: "x" } })],
      [404, await send({ method: "POST", url, as: outsider, body: { text: "x" } })],
    ] as const) {
      expect(res.statusCode).toBe(status);
      conforms("pasteEmail", res);
    }
  });

  it("downloadJobPackage: 200 zip, 400, 401 and 404 as declared", async () => {
    const ok = await send({ url: `/v1/jobs/${jobId}/package`, as: client });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/zip");
    expect([...(await readZip(ok.rawPayload)).keys()].some((k) => k.endsWith("/Job summary.txt"))).toBe(true);
    for (const [status, res] of [
      [400, await send({ url: "/v1/jobs/nope/package", as: staff })],
      [401, await send({ url: `/v1/jobs/${jobId}/package` })],
      [404, await send({ url: `/v1/jobs/${jobId}/package`, as: outsider })],
    ] as const) {
      expect(res.statusCode).toBe(status);
      conforms("downloadJobPackage", res);
    }
  });
});
