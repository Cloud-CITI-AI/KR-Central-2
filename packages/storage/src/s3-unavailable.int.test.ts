import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StorageUnavailableError, createS3Storage, isStorageUnavailable, type S3Storage } from "./index.js";

/** A port nothing listens on: bind to 0, note the port, close. */
async function closedPort(): Promise<number> {
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
  return port;
}

describe("createS3Storage when the bucket cannot be reached", () => {
  let down: S3Storage;
  let slow: S3Storage;
  let hang: ReturnType<typeof createServer>;

  beforeAll(async () => {
    const credentials = { accessKeyId: "k", secretAccessKey: "s", region: "us-east-1", bucket: "kr-test" };
    down = createS3Storage({
      ...credentials,
      endpoint: `http://127.0.0.1:${await closedPort()}`,
      forcePathStyle: true,
      connectTimeoutMs: 500,
    });
    // Accepts connections and never answers: the request timeout fires.
    hang = createServer(() => undefined);
    await new Promise<void>((resolve) =>
      hang.listen(0, "127.0.0.1", () => {
        resolve();
      }),
    );
    slow = createS3Storage({
      ...credentials,
      endpoint: `http://127.0.0.1:${(hang.address() as AddressInfo).port}`,
      forcePathStyle: true,
      timeoutMs: 300,
    });
  });
  afterAll(async () => {
    down.close();
    slow.close();
    hang.closeAllConnections();
    await new Promise<void>((resolve) =>
      hang.close(() => {
        resolve();
      }),
    );
  });

  it("rejects every operation with StorageUnavailableError on a refused connection", async () => {
    const key = "jobs/j/f";
    const body = (): Readable => Readable.from([Buffer.from("hello")], { objectMode: false });
    const operations: [string, () => Promise<unknown>][] = [
      ["put", () => down.put({ key, body: body(), contentType: "text/plain" })],
      ["get", () => down.get(key)],
      ["head", () => down.head(key)],
      ["exists", () => down.exists(key)],
      ["delete", () => down.delete(key)],
      ["list", async () => await down.list("jobs/")[Symbol.asyncIterator]().next()],
    ];
    for (const [name, run] of operations) {
      const error: unknown = await run().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error, name).toBeInstanceOf(StorageUnavailableError);
      expect(isStorageUnavailable(error), name).toBe(true);
    }
  });

  it("rejects with StorageUnavailableError when the store accepts the connection but never answers", async () => {
    await expect(slow.head("jobs/j/f")).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("keeps the original failure as the cause", async () => {
    const error = await down.head("jobs/j/f").catch((e: unknown) => e);
    expect((error as StorageUnavailableError).cause).toBeInstanceOf(Error);
  });
});
