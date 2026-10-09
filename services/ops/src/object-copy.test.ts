import { createMemoryStorage } from "@kr/storage/testing";
import type { ObjectStorage } from "@kr/storage";
import { silentLog as log } from "../test/silent-log.js";
import { describe, expect, it } from "vitest";
import { ObjectCopyError, copyObjects } from "./object-copy.js";
import { loadManifest } from "./manifest.js";

const DAY = 86_400_000;

async function put(storage: ObjectStorage, key: string, text: string): Promise<void> {
  await storage.put({ key, body: Buffer.from(text), contentType: "application/pdf" });
}

async function text(storage: ObjectStorage, key: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await storage.get(key)).body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function setup(retentionDays = 35) {
  const source = createMemoryStorage();
  const backup = createMemoryStorage();
  let now = new Date("2026-10-09T18:15:00Z");
  const puts: string[] = [];
  const countingBackup: ObjectStorage = {
    ...backup,
    put: (input) => {
      puts.push(input.key);
      return backup.put(input);
    },
  };
  const run = (over: Partial<Parameters<typeof copyObjects>[0]> = {}) =>
    copyObjects({ source, backup: countingBackup, clock: { now: () => now }, log, retentionDays, ...over });
  return {
    source,
    backup,
    puts,
    run,
    advanceDays: (n: number) => {
      now = new Date(now.getTime() + n * DAY);
    },
  };
}

describe("copyObjects", () => {
  it("copies new source objects under objects/ and records them in the manifest", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "first");
    await put(t.source, "jobs/b/2", "second file");
    const result = await t.run();
    expect(result).toMatchObject({ copied: 2, bytes: 16, purged: 0 });
    expect(await text(t.backup, "objects/jobs/a/1")).toBe("first");
    expect((await t.backup.head("objects/jobs/b/2")).contentType).toBe("application/pdf");
    expect(Object.keys(await loadManifest(t.backup)).sort()).toEqual(["jobs/a/1", "jobs/b/2"]);
  });

  it("copies only what changed on later runs", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "first");
    await put(t.source, "jobs/b/2", "second");
    await t.run();
    t.puts.length = 0;
    expect(await t.run()).toMatchObject({ copied: 0 });
    expect(t.puts).toEqual(["manifest.json"]);

    await put(t.source, "jobs/b/2", "second, edited"); // same key, new size and etag
    await put(t.source, "jobs/c/3", "third");
    t.puts.length = 0;
    await t.run();
    expect(t.puts.sort()).toEqual(["manifest.json", "objects/jobs/b/2", "objects/jobs/c/3"]);
    expect(await text(t.backup, "objects/jobs/b/2")).toBe("second, edited");
  });

  it("repairs a copy that was deleted from the backup bucket", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "first");
    await t.run();
    await t.backup.delete("objects/jobs/a/1");
    expect(await t.run()).toMatchObject({ copied: 1 });
    expect(await t.backup.exists("objects/jobs/a/1")).toBe(true);
  });

  it("keeps the copy of a deleted source for the retention period, then deletes it and its record", async () => {
    const t = setup(35);
    await put(t.source, "jobs/a/1", "kept");
    await put(t.source, "jobs/b/2", "removed later");
    await t.run();
    await t.source.delete("jobs/b/2");

    expect(await t.run()).toMatchObject({ newlyMissing: 1, purged: 0 });
    expect((await loadManifest(t.backup))["jobs/b/2"]?.missingSince).toBe("2026-10-09T18:15:00.000Z");

    t.advanceDays(35);
    expect(await t.run()).toMatchObject({ purged: 0 }); // gone for exactly 35 days: still kept
    expect(await t.backup.exists("objects/jobs/b/2")).toBe(true);

    t.advanceDays(1);
    expect(await t.run()).toMatchObject({ purged: 1 });
    expect(await t.backup.exists("objects/jobs/b/2")).toBe(false);
    expect(Object.keys(await loadManifest(t.backup))).toEqual(["jobs/a/1"]);
    expect(await t.backup.exists("objects/jobs/a/1")).toBe(true);
  });

  it("clears the gone-since time when a source reappears", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "kept");
    await t.run();
    const bytes = await text(t.source, "jobs/a/1");
    await t.source.delete("jobs/a/1");
    await t.run();
    await put(t.source, "jobs/a/1", bytes);
    expect(await t.run()).toMatchObject({ reappeared: 1 });
    expect((await loadManifest(t.backup))["jobs/a/1"]?.missingSince).toBeNull();
  });

  it("starts the retention clock for a copy that has no record and no source", async () => {
    const t = setup();
    await put(t.backup, "objects/jobs/lost/1", "orphan");
    expect(await t.run()).toMatchObject({ newlyMissing: 1, copied: 0 });
    t.advanceDays(36);
    expect(await t.run()).toMatchObject({ purged: 1 });
    expect(await t.backup.exists("objects/jobs/lost/1")).toBe(false);
  });

  it("tolerates an object deleted between the listing and the read", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "first");
    await put(t.source, "jobs/a/2", "vanishes");
    const flaky: typeof t.source = {
      ...t.source,
      get: async (key, range) => {
        if (key === "jobs/a/2") await t.source.delete(key);
        return t.source.get(key, range);
      },
    };
    expect(await t.run({ source: flaky })).toMatchObject({ copied: 1, vanished: 1 });
  });

  it("copies what it can, saves the manifest, then fails when one object cannot be read", async () => {
    const t = setup();
    await put(t.source, "jobs/a/1", "first");
    await put(t.source, "jobs/a/2", "broken");
    await put(t.source, "jobs/a/3", "third");
    const broken: typeof t.source = {
      ...t.source,
      get: (key, range) =>
        key === "jobs/a/2" ? Promise.reject(new Error("socket hang up")) : t.source.get(key, range),
    };
    const failed = await t.run({ source: broken }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ObjectCopyError);
    expect((failed as ObjectCopyError).failures).toEqual(["copy jobs/a/2: socket hang up"]);
    expect(Object.keys(await loadManifest(t.backup)).sort()).toEqual(["jobs/a/1", "jobs/a/3"]);

    expect(await t.run()).toMatchObject({ copied: 1 }); // the next run retries only the failed object
    expect(await text(t.backup, "objects/jobs/a/2")).toBe("broken");
  });

  it("keeps the record and fails when an expired copy cannot be deleted", async () => {
    const t = setup(35);
    await put(t.source, "jobs/a/1", "kept");
    await t.run();
    await t.source.delete("jobs/a/1");
    await t.run();
    t.advanceDays(40);
    const stuck: ObjectStorage = { ...t.backup, delete: () => Promise.reject(new Error("AccessDenied")) };
    await expect(t.run({ backup: stuck })).rejects.toThrow(/purge jobs\/a\/1: AccessDenied/);
    expect(Object.keys(await loadManifest(t.backup))).toEqual(["jobs/a/1"]);
  });
});
