import { InvalidRangeError } from "@kr/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { mp4Bytes, pdfBytes, seedFile } from "../testing.js";

describe("getFileContent with Range (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn;
  let jobId: string;
  const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const get = (id: string, range?: string, who: SignedIn | null = staff) =>
    apiRequest(t, {
      url: `/v1/files/${id}/content`,
      ...(who ? { as: who } : {}),
      ...(range ? { headers: { range } } : {}),
    });
  const video = () =>
    seedFile(t, f, {
      jobId,
      data: Buffer.concat([mp4Bytes(), data]),
      kind: "video",
      contentType: "video/mp4",
      name: "site.mp4",
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
    jobId = (await f.makeJob()).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it.each([
    ["bytes=0-99", 0, 99],
    ["bytes=500-509", 500, 509],
    ["bytes=-50", -50, undefined],
    ["bytes=900-", 900, undefined],
  ] as const)("%s is a 206 with the matching bytes, Content-Range and Content-Length", async (range, from, to) => {
    const file = await seedFile(t, f, { jobId, data });
    const res = await get(file.id, range);
    const expected = data.subarray(from, to === undefined ? undefined : to + 1);
    const start = from < 0 ? data.length + from : from;
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload).toEqual(expected);
    expect(res.headers).toMatchObject({
      "content-range": `bytes ${start}-${start + expected.length - 1}/${data.length}`,
      "content-length": String(expected.length),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });

  it("streams a video in ranges with its own type and the sandbox CSP", async () => {
    const file = await video();
    const res = await get(file.id, "bytes=0-9");
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
  });

  it("serves the whole file when the Range header is several ranges, another unit or malformed", async () => {
    const file = await seedFile(t, f, { jobId, data });
    for (const range of ["bytes=0-5,10-20", "items=0-5", "bytes=oops", "bytes=5-3"]) {
      const res = await get(file.id, range);
      expect(res.statusCode, range).toBe(200);
      expect(res.rawPayload).toEqual(data);
    }
  });

  it("answers 416 with Content-Range: bytes */size when the range starts after the end", async () => {
    const file = await seedFile(t, f, { jobId, data });
    for (const range of [`bytes=${data.length}-`, "bytes=5000-6000", "bytes=-0"]) {
      const res = await get(file.id, range);
      expect(res.statusCode, range).toBe(416);
      expect(res.headers["content-range"]).toBe(`bytes */${data.length}`);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toMatchObject({
        status: 416,
        title: "Range not satisfiable",
        detail: `The file has ${data.length} bytes.`,
      });
    }
  });

  it("answers 416 when the storage says the range is outside an object that is shorter than recorded", async () => {
    const short = await createTestApp({
      storage: { ...t.storage, get: (key) => Promise.reject(new InvalidRangeError(key)) },
    });
    const lf = createFactories(short.db, 301);
    const user = await signIn(short, await lf.makeUser({ role: "staff" }));
    const job = await lf.makeJob();
    const file = await seedFile(short, lf, { jobId: job.id, data });
    const res = await apiRequest(short, {
      url: `/v1/files/${file.id}/content`,
      as: user,
      headers: { range: "bytes=0-9" },
    });
    expect(res.statusCode).toBe(416);
    await short.close();
  });

  it("applies the scan gate and authorisation to ranged requests too", async () => {
    const pending = await seedFile(t, f, { jobId, data: pdfBytes(), scanStatus: "pending" });
    expect((await get(pending.id, "bytes=0-9")).statusCode).toBe(409);
    expect((await get(pending.id, "bytes=0-9", null)).statusCode).toBe(401);
  });
});
