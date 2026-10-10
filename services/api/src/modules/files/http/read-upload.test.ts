import { createHash } from "node:crypto";
import { createLogger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { createMemoryStorage } from "@kr/storage/testing";
import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "../../../platform/errors.js";
import { discard, isMultipartParseError, readUpload } from "./read-upload.js";

const JOB = "6f9b6c3e-2f0b-4c44-8d6a-0d3a5f1c9b10";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"), Buffer.alloc(200)]);
const lines: string[] = [];
const log = createLogger({ service: "t", env: "test", destination: { write: (m: string) => void lines.push(m) } });

type Part =
  | { type: "field"; fieldname: string; value: unknown }
  | { type: "file"; fieldname: string; filename: string; file: Readable };
const field = (fieldname: string, value: string): Part => ({ type: "field", fieldname, value });
const file = (data: Buffer, filename = "plan.pdf", fieldname = "file"): Part => ({
  type: "file",
  fieldname,
  filename,
  file: Readable.from([data.subarray(0, 100), data.subarray(100)]),
});
const request = (parts: Part[], multipart = true) =>
  ({ isMultipart: () => multipart, parts: () => parts }) as unknown as FastifyRequest;
const SLOT = [field("checkpointKey", "i2_0"), field("slot", "survey")];

async function keys(storage: ObjectStorage): Promise<string[]> {
  const out: string[] = [];
  for await (const o of storage.list("jobs/")) out.push(o.key);
  return out;
}
const options = (
  storage: ObjectStorage,
  parts: Part[],
  extra: { maxBytes?: number; authorise?: () => Promise<void> } = {},
) => ({
  request: request(parts),
  storage,
  log,
  jobId: JOB,
  maxBytes: extra.maxBytes ?? 1024,
  authorise: extra.authorise ?? (() => Promise.resolve()),
});

describe("readUpload", () => {
  it("stores the file under jobs/<jobId>/<fileId> and reports its hash, size, kind and target", async () => {
    const storage = createMemoryStorage();
    const stored = await readUpload(options(storage, [...SLOT, file(PDF, `Plan${String.fromCodePoint(0x202e)}.pdf`)]));
    expect(stored).toMatchObject({
      storageKey: `jobs/${JOB}/${stored.fileId}`,
      originalName: "Plan.pdf",
      classification: { kind: "pdf", contentType: "application/pdf" },
      sizeBytes: PDF.length,
      target: { type: "slot", checkpointKey: "i2_0" },
    });
    expect(stored.sha256.toString("hex")).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(await keys(storage)).toEqual([stored.storageKey]);
  });

  it("refuses a request that is not multipart (415)", async () => {
    await expect(readUpload({ ...options(createMemoryStorage(), []), request: request([], false) })).rejects.toThrow(
      UnsupportedMediaTypeError,
    );
  });

  it("validates the fields before it authorises, and authorises before it reads a byte of the file", async () => {
    const storage = createMemoryStorage();
    const authorise = vi.fn(() => Promise.reject(new ForbiddenError()));
    await expect(readUpload(options(storage, [field("slot", "survey"), file(PDF)], { authorise }))).rejects.toThrow(
      BadRequestError,
    );
    expect(authorise).not.toHaveBeenCalled();
    const body = file(PDF);
    await expect(readUpload(options(storage, [...SLOT, body], { authorise }))).rejects.toThrow(ForbiddenError);
    expect(authorise).toHaveBeenCalledTimes(1);
    expect((body as { file: Readable }).file.readableDidRead).toBe(false);
    expect(await keys(storage)).toEqual([]);
  });

  it("refuses a file that is not what the slot accepts, and stores nothing", async () => {
    const storage = createMemoryStorage();
    await expect(readUpload(options(storage, [...SLOT, file(Buffer.from("<html></html>"), "a.pdf")]))).rejects.toThrow(
      UnsupportedMediaTypeError,
    );
    expect(await keys(storage)).toEqual([]);
  });

  it("answers 413 above the cap even when the storage adapter wraps the stream failure", async () => {
    const wrapping: ObjectStorage = {
      ...createMemoryStorage(),
      put: async (input) => {
        for await (const chunk of input.body as AsyncIterable<Buffer>) expect(chunk.length).toBeGreaterThan(0);
        throw new Error("wrapped");
      },
    };
    const big = Buffer.concat([PDF, Buffer.alloc(2000)]);
    const error = await readUpload(options(wrapping, [...SLOT, file(big, "Big.pdf")])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect((error as PayloadTooLargeError).detail).toBe("Big.pdf is larger than 0.0 MB.");
  });

  it("needs exactly one file part named file, after the fields", async () => {
    const storage = createMemoryStorage();
    await expect(readUpload(options(storage, SLOT))).rejects.toThrow(BadRequestError);
    await expect(readUpload(options(storage, [...SLOT, file(PDF, "a.pdf", "upload")]))).rejects.toThrow(
      BadRequestError,
    );
    expect(await keys(storage)).toEqual([]);
  });

  it("removes the object when a part arrives after the file", async () => {
    for (const trailing of [file(PDF), field("late", "x")]) {
      const storage = createMemoryStorage();
      await expect(readUpload(options(storage, [...SLOT, file(PDF), trailing]))).rejects.toThrow(BadRequestError);
      expect(await keys(storage)).toEqual([]);
    }
  });

  it("ignores a non-text field value", async () => {
    const stored = await readUpload(
      options(createMemoryStorage(), [...SLOT, { type: "field", fieldname: "x", value: 1 }, file(PDF)]),
    );
    expect(stored.sizeBytes).toBe(PDF.length);
  });
});

describe("discard", () => {
  it("logs, instead of failing, when the object cannot be removed", async () => {
    const storage: ObjectStorage = { ...createMemoryStorage(), delete: () => Promise.reject(new Error("bucket down")) };
    await discard(storage, log, "jobs/x/y");
    expect(lines.map((l) => JSON.parse(l) as { event?: string })).toContainEqual(
      expect.objectContaining({ event: "orphan_object", key: "jobs/x/y" }),
    );
  });
});

describe("isMultipartParseError", () => {
  it("recognises busboy and premature-close failures of the request body", () => {
    for (const message of [
      "Multipart: Boundary not found",
      "Unexpected end of multipart data",
      "Unexpected end of form",
      "Malformed part header",
    ]) {
      expect(isMultipartParseError(new Error(message))).toBe(true);
    }
    expect(
      isMultipartParseError(Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" })),
    ).toBe(true);
  });

  it("leaves storage, database, limit and non-error values alone", () => {
    expect(isMultipartParseError(new Error("connect ECONNREFUSED 127.0.0.1:9000"))).toBe(false);
    expect(isMultipartParseError(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe(false);
    expect(isMultipartParseError(new PayloadTooLargeError())).toBe(false);
    expect(isMultipartParseError("Multipart: Boundary not found")).toBe(false);
    expect(isMultipartParseError(undefined)).toBe(false);
  });
});
