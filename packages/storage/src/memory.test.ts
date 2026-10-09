import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { describeObjectStorageContract } from "../test/object-storage-contract.js";
import { createMemoryStorage } from "./testing.js";

describeObjectStorageContract("memory", () => createMemoryStorage());

describe("createMemoryStorage", () => {
  it("stamps lastModified from the injected clock and hands out copies of it", async () => {
    const at = new Date("2026-03-04T05:06:07Z");
    const storage = createMemoryStorage({ now: () => at });
    await storage.put({ key: "k", body: Readable.from([Buffer.from("x")]), contentType: "text/plain" });
    const head = await storage.head("k");
    expect(head.lastModified).toEqual(at);
    head.lastModified.setFullYear(1999);
    expect((await storage.head("k")).lastModified).toEqual(at);
  });
});
