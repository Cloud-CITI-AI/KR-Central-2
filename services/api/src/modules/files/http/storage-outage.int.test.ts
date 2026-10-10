import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createS3Storage, type ObjectStorage } from "@kr/storage";
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
import { pdfBytes, uploadFile } from "../testing.js";

/** An endpoint nothing listens on: bind to 0, note the port, close. */
async function unreachableStorage(): Promise<ObjectStorage & { close(): void }> {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      resolve();
    }),
  );
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return createS3Storage({
    endpoint: `http://127.0.0.1:${port}`,
    region: "us-east-1",
    bucket: "kr-test",
    accessKeyId: "k",
    secretAccessKey: "s",
    forcePathStyle: true,
    connectTimeoutMs: 500,
    timeoutMs: 1_000,
  });
}

describe("files while object storage is unreachable (real Postgres, S3 adapter on a closed port)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn;
  let storage: Awaited<ReturnType<typeof unreachableStorage>>;
  let jobId: string;

  beforeAll(async () => {
    storage = await unreachableStorage();
    t = await createTestApp({ storage, config: testConfig({ RATE_LIMIT_UPLOADS_PER_MINUTE: "1000" }) });
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
    jobId = (await f.makeJob()).id;
  });
  afterAll(async () => {
    await t.close();
    storage.close();
  });

  const expectUnavailable = (res: Awaited<ReturnType<typeof apiRequest>>) => {
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toEqual({
      type: "urn:kr:problem:storage-unavailable",
      title: "Service unavailable",
      status: 503,
      detail: "File storage is temporarily unavailable. Try again shortly.",
      instance: expect.any(String),
      requestId: expect.any(String),
    });
  };

  it("answers an upload with 503, Retry-After and the storage-unavailable type, and records nothing", async () => {
    const res = await uploadFile(t, {
      jobId,
      as: staff,
      fields: { checkpointKey: "i2_0", slot: "survey" },
      file: { name: "Plan.pdf", data: pdfBytes(300) },
    });
    expectUnavailable(res);
    expect(await t.db.selectFrom("files").select("id").where("job_id", "=", jobId).execute()).toEqual([]);
    expect(await t.db.selectFrom("audit_events").select("id").where("job_id", "=", jobId).execute()).toEqual([]);
  });

  it("answers a download with 503, Retry-After and the storage-unavailable type", async () => {
    const file = await f.makeFile({ jobId, scanStatus: "clean" });
    expectUnavailable(await apiRequest(t, { url: `/v1/files/${file.id}/content`, as: staff }));
  });

  it("logs the outage as a warning, not as a failed request", async () => {
    const file = await f.makeFile({ jobId, scanStatus: "clean" });
    await apiRequest(t, { url: `/v1/files/${file.id}/content`, as: staff });
    const lines = t.logLines();
    expect(lines.some((l) => l.event === "storage_unavailable" && l.level === "warn")).toBe(true);
    expect(lines.some((l) => l.event === "request_failed" && l.status === 503)).toBe(false);
  });
});
