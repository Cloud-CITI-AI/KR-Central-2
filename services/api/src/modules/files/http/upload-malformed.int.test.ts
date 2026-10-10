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
import { pdfBytes } from "../testing.js";

const BOUNDARY = "----krmalformed1a2b3c";

describe("uploadFile with a malformed multipart body (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn;
  let jobId: string;

  const send = (payload: string | Buffer, contentType: string) =>
    apiRequest(t, {
      method: "POST",
      url: `/v1/jobs/${jobId}/files`,
      as: staff,
      body: payload,
      headers: { "content-type": contentType },
    });
  const multipart = `multipart/form-data; boundary=${BOUNDARY}`;
  const fields =
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="checkpointKey"\r\n\r\ni2_0\r\n` +
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="slot"\r\n\r\nsurvey\r\n`;
  const filePartHead =
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="Plan.pdf"\r\n` +
    "Content-Type: application/pdf\r\n\r\n";
  const storedKeys = async () => {
    const keys: string[] = [];
    for await (const o of t.storage.list("jobs/")) keys.push(o.key);
    return keys;
  };
  const expectParseProblem = (res: Awaited<ReturnType<typeof send>>) => {
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "urn:kr:problem:validation",
      status: 400,
      detail: "The request could not be parsed.",
    });
  };

  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ RATE_LIMIT_UPLOADS_PER_MINUTE: "1000" }) });
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
    jobId = (await f.makeJob()).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("answers 400 for multipart/form-data with no boundary", async () => {
    expectParseProblem(await send(fields, "multipart/form-data"));
  });

  it("answers 400 for a body that is not multipart at all", async () => {
    expectParseProblem(await send("garbage garbage", multipart));
  });

  it("answers 400 for a body cut off before the fields end", async () => {
    expectParseProblem(
      await send(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="slot"\r\n\r\nsur`, multipart),
    );
  });

  it("answers 400 and leaves no object when the file part has no closing boundary", async () => {
    const before = await storedKeys();
    expectParseProblem(await send(Buffer.concat([Buffer.from(fields + filePartHead), pdfBytes(200)]), multipart));
    expect(await storedKeys()).toEqual(before);
    expect(await t.db.selectFrom("files").select("id").where("job_id", "=", jobId).execute()).toEqual([]);
  });
});
