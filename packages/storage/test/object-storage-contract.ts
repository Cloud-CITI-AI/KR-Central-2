/** One behavioural suite for every ObjectStorage implementation (memory fake and S3 adapter). */
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { InvalidRangeError, ObjectNotFoundError, type ObjectStorage } from "../src/index.js";

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
};
const bytesOf = async (body: Readable): Promise<Buffer> => Buffer.concat(await collect(body as AsyncIterable<Buffer>));
const textOf = async (body: Readable): Promise<string> => (await bytesOf(body)).toString("utf8");
const stream = (...chunks: Buffer[]): Readable => Readable.from(chunks, { objectMode: false });
const digits = Buffer.from("0123456789");

export function describeObjectStorageContract(
  name: string,
  create: () => Promise<ObjectStorage> | ObjectStorage,
): void {
  describe(`ObjectStorage contract: ${name}`, () => {
    let cached: Promise<ObjectStorage> | undefined;
    const storage = (): Promise<ObjectStorage> => (cached ??= Promise.resolve(create()));
    /** Unique prefix per test so tests never see each other's objects. */
    const prefix = (): string => `contract/${randomUUID()}/`;
    const seed = async (key: string, data: Buffer = digits, contentType = "text/plain"): Promise<void> => {
      await (await storage()).put({ key, body: data, contentType });
    };

    it("streams a put and reports the sha256 and size computed on the way", async () => {
      const key = `${prefix()}a`;
      const chunks = [Buffer.from("hello "), Buffer.from("streaming "), Buffer.from("world")];
      const result = await (await storage()).put({ key, body: stream(...chunks), contentType: "text/plain" });
      expect(result).toEqual({ sha256: sha256(Buffer.concat(chunks)), size: 21 });
      const got = await (await storage()).get(key);
      expect(await textOf(got.body)).toBe("hello streaming world");
      expect(got).toMatchObject({ size: 21, contentType: "text/plain" });
      expect(got.range).toBeUndefined();
      expect(got.contentRange).toBeUndefined();
    });

    it("stores a Uint8Array and an empty body", async () => {
      const key = `${prefix()}b`;
      expect(
        await (await storage()).put({ key, body: new Uint8Array(digits), contentType: "application/pdf" }),
      ).toEqual({
        sha256: sha256(digits),
        size: 10,
      });
      const empty = await (await storage()).put({ key: `${key}-empty`, body: stream(), contentType: "text/plain" });
      expect(empty).toEqual({ sha256: sha256(Buffer.alloc(0)), size: 0 });
      expect((await (await storage()).head(`${key}-empty`)).size).toBe(0);
    });

    it("replaces an existing object", async () => {
      const key = `${prefix()}c`;
      await seed(key);
      await seed(key, Buffer.from("new"), "image/png");
      const got = await (await storage()).get(key);
      expect(await textOf(got.body)).toBe("new");
      expect(got.contentType).toBe("image/png");
    });

    it("stores nothing when the body stream fails", async () => {
      const key = `${prefix()}d`;
      const failing = new Readable({
        read() {
          this.push(Buffer.from("partial"));
          this.destroy(new Error("source broke"));
        },
      });
      await expect((await storage()).put({ key, body: failing, contentType: "text/plain" })).rejects.toThrow();
      expect(await (await storage()).exists(key)).toBe(false);
    });

    it("keeps keys with spaces and non-ASCII characters intact", async () => {
      const dir = prefix();
      const key = `${dir}Plan 1 & ü – ñ+x?.txt`;
      await seed(key);
      expect(await (await storage()).exists(key)).toBe(true);
      expect((await collect((await storage()).list(dir))).map((e) => e.key)).toEqual([key]);
    });

    it.each([
      [{ start: 2, end: 5 }, "2345", "bytes 2-5/10"],
      [{ start: 7 }, "789", "bytes 7-9/10"],
      [{ start: 0, end: 0 }, "0", "bytes 0-0/10"],
      [{ start: 8, end: 999 }, "89", "bytes 8-9/10"],
    ])("serves range %j", async (range, expected, contentRange) => {
      const key = `${prefix()}r`;
      await seed(key);
      const got = await (await storage()).get(key, range);
      expect(await textOf(got.body)).toBe(expected);
      expect(got).toMatchObject({ size: 10, contentRange });
      expect(got.range).toEqual({ start: range.start, end: range.start + expected.length - 1 });
    });

    it.each([{ start: 10 }, { start: 50, end: 60 }, { start: 5, end: 2 }])("rejects range %j", async (range) => {
      const key = `${prefix()}r`;
      await seed(key);
      await expect((await storage()).get(key, range)).rejects.toBeInstanceOf(InvalidRangeError);
    });

    it("raises ObjectNotFoundError for missing keys", async () => {
      const key = `${prefix()}missing`;
      const s = await storage();
      await expect(s.get(key)).rejects.toMatchObject({ name: "ObjectNotFoundError", key });
      await expect(s.get(key, { start: 0 })).rejects.toBeInstanceOf(ObjectNotFoundError);
      await expect(s.head(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
      expect(await s.exists(key)).toBe(false);
    });

    it("describes an object with head", async () => {
      const key = `${prefix()}h`;
      await seed(key, digits, "image/png");
      const head = await (await storage()).head(key);
      expect(head).toMatchObject({ size: 10, contentType: "image/png" });
      expect(head.etag).not.toBe("");
      expect(head.etag).not.toContain('"');
      expect(head.lastModified).toBeInstanceOf(Date);
      expect(Math.abs(Date.now() - head.lastModified.getTime())).toBeLessThan(5 * 60_000);
    });

    it("deletes idempotently", async () => {
      const key = `${prefix()}x`;
      const s = await storage();
      await seed(key);
      await s.delete(key);
      expect(await s.exists(key)).toBe(false);
      await expect(s.delete(key)).resolves.toBeUndefined();
      await expect(s.delete(`${key}-never-existed`)).resolves.toBeUndefined();
    });

    it("lists by prefix in key order, across pages, without sibling prefixes", async () => {
      const dir = prefix();
      const keys = ["b", "a", "c/2", "c/10", "c/1", "e"].map((k) => `${dir}${k}`);
      for (const key of keys) await seed(key, Buffer.from(key));
      await seed(`${dir.slice(0, -1)}x/other`); // shares the text before the slash, not the prefix
      const s = await storage();
      const expected = [...keys].sort();
      for (const pageSize of [undefined, 1, 2, 4]) {
        const entries = await collect(s.list(dir, pageSize === undefined ? {} : { pageSize }));
        expect(entries.map((e) => e.key)).toEqual(expected);
      }
      const first = (await collect(s.list(dir)))[0];
      expect(first).toMatchObject({ key: `${dir}a`, size: `${dir}a`.length });
      expect(first?.lastModified).toBeInstanceOf(Date);
      expect(first?.etag).not.toBe("");
      expect((await collect(s.list(`${dir}c/`))).map((e) => e.key)).toEqual([`${dir}c/1`, `${dir}c/10`, `${dir}c/2`]);
      expect(await collect(s.list(`${dir}nothing`))).toEqual([]);
    });

    it("rejects invalid keys", async () => {
      const s = await storage();
      await expect(s.put({ key: "", body: digits, contentType: "text/plain" })).rejects.toThrow(RangeError);
      await expect(s.get("")).rejects.toThrow(RangeError);
      await expect(s.head("x".repeat(1025))).rejects.toThrow(RangeError);
      await expect(s.exists("")).rejects.toThrow(RangeError);
      await expect(s.delete("")).rejects.toThrow(RangeError);
    });

    it("answers the readiness probe", async () => {
      await expect((await storage()).ping()).resolves.toBeUndefined();
    });

    it("returns bodies that other reads and later writes cannot disturb", async () => {
      const key = `${prefix()}iso`;
      const input = Buffer.from("abc");
      await seed(key, input);
      input.fill(0x7a); // mutate the caller's buffer after the put
      const got = await (await storage()).get(key);
      expect(await bytesOf(got.body)).toEqual(Buffer.from("abc"));
    });
  });
}
