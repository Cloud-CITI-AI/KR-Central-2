import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Readable } from "node:stream";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeObjectStorageContract } from "../test/object-storage-contract.js";
import { createS3Storage, type S3Storage, type S3StorageConfig } from "./index.js";

const BUCKET = "kr-test";
const MIB = 1024 * 1024;
const credentials = { accessKeyId: "test-key", secretAccessKey: "test-secret", region: "us-east-1" };
let container: StartedTestContainer;
let storage: S3Storage;

beforeAll(async () => {
  container = await new GenericContainer("adobe/s3mock:latest")
    .withExposedPorts(9090)
    .withEnvironment({ COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: BUCKET })
    .withWaitStrategy(Wait.forLogMessage(/Started S3MockApplication/))
    .start();
  storage = createS3Storage({
    ...credentials,
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9090)}`,
    bucket: BUCKET,
    forcePathStyle: true,
  });
});

afterAll(async () => {
  storage.close();
  await container.stop();
});

describeObjectStorageContract("s3 (adobe/s3mock)", () => storage);

describe("createS3Storage against s3mock", () => {
  it("streams 20 MiB through a multipart upload, hashing as it goes, and serves ranges of it", async () => {
    const hash = createHash("sha256");
    const chunk = (i: number): Buffer => Buffer.alloc(MIB, i % 251);
    for (let i = 0; i < 20; i++) hash.update(chunk(i));
    function* chunks(): Generator<Buffer> {
      for (let i = 0; i < 20; i++) yield chunk(i);
    }
    const key = "big/20mib";
    const result = await storage.put({
      key,
      body: Readable.from(chunks(), { objectMode: false }),
      contentType: "application/pdf",
    });
    expect(result).toEqual({ sha256: hash.digest("hex"), size: 20 * MIB });
    expect(await storage.head(key)).toMatchObject({ size: 20 * MIB, contentType: "application/pdf" });
    // A range spanning the 8 MiB part boundary and the 1 MiB chunk values.
    const got = await storage.get(key, { start: 8 * MIB - 2, end: 8 * MIB + 1 });
    const parts: Buffer[] = [];
    for await (const part of got.body as AsyncIterable<Buffer>) parts.push(part);
    const bytes = Buffer.concat(parts);
    expect([...bytes]).toEqual([7, 7, 8, 8]);
    expect(got).toMatchObject({ size: 20 * MIB, contentRange: `bytes ${8 * MIB - 2}-${8 * MIB + 1}/${20 * MIB}` });
    await storage.delete(key);
  });

  it("fails the readiness probe when the endpoint is unreachable", async () => {
    const other = createS3Storage({
      ...credentials,
      endpoint: "http://127.0.0.1:1",
      bucket: BUCKET,
      forcePathStyle: true,
    });
    await expect(other.ping()).rejects.toThrow();
    other.close();
  });
});

describe("timeouts and retries (stub endpoint)", () => {
  let server: Server;
  let hits: string[];
  let behaviour: "error" | "hang" | "dribble";
  const sockets = new Set<Socket>();
  const connect = (extra: Partial<S3StorageConfig> = {}): S3Storage =>
    createS3Storage({
      ...credentials,
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      bucket: BUCKET,
      forcePathStyle: true,
      ...extra,
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.method ?? "");
      req.resume();
      if (behaviour === "hang") return;
      if (behaviour === "dribble") {
        res.writeHead(200, { "content-type": "text/plain", "content-length": "5" });
        let sent = 0;
        const timer = setInterval(() => {
          res.write("x");
          if (++sent === 5) {
            clearInterval(timer);
            res.end();
          }
        }, 100);
        return;
      }
      res.writeHead(500, { "content-type": "application/xml" }).end("<Error><Code>InternalError</Code></Error>");
    });
    server.on("connection", (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    sockets.forEach((s) => s.destroy());
    await new Promise((resolve) => server.close(resolve));
  });

  it("retries reads three times but never retries a write", async () => {
    behaviour = "error";
    const s3 = connect();
    hits = [];
    await expect(s3.get("k")).rejects.toThrow();
    expect(hits).toEqual(["GET", "GET", "GET"]);
    hits = [];
    await expect(s3.put({ key: "k", body: new Uint8Array(3), contentType: "text/plain" })).rejects.toThrow();
    expect(hits).toEqual(["PUT"]);
    s3.close();
  });

  it("does not time out a slow response that keeps sending (the timeout is on idleness)", async () => {
    behaviour = "dribble";
    const s3 = connect({ timeoutMs: 300 });
    const got = await s3.get("k");
    const parts: Buffer[] = [];
    for await (const part of got.body as AsyncIterable<Buffer>) parts.push(part);
    expect(Buffer.concat(parts).toString()).toBe("xxxxx");
    s3.close();
  });

  it("gives up on a connection that goes idle", async () => {
    behaviour = "hang";
    const s3 = connect({ timeoutMs: 150 });
    hits = [];
    await expect(s3.ping()).rejects.toMatchObject({ name: "TimeoutError" });
    s3.close();
  });
});
