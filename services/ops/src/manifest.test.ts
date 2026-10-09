import { createMemoryStorage } from "@kr/storage/testing";
import { describe, expect, it } from "vitest";
import { ManifestError, loadManifest, saveManifest } from "./manifest.js";

const at = new Date("2026-10-09T07:00:00Z");
const entry = { size: 3, etag: "abc", copiedAt: "2026-10-08T07:00:00.000Z", missingSince: null };

describe("manifest", () => {
  it("is empty on a first run", async () => {
    expect(await loadManifest(createMemoryStorage())).toEqual({});
  });

  it("round-trips what was saved", async () => {
    const storage = createMemoryStorage();
    await saveManifest(
      storage,
      { "jobs/a/1": entry, "jobs/a/2": { ...entry, missingSince: "2026-10-01T00:00:00.000Z" } },
      at,
    );
    expect(await loadManifest(storage)).toEqual({
      "jobs/a/1": entry,
      "jobs/a/2": { ...entry, missingSince: "2026-10-01T00:00:00.000Z" },
    });
    expect((await storage.head("manifest.json")).contentType).toBe("application/json");
  });

  it.each([
    ["not JSON", "{nope"],
    ["wrong version", JSON.stringify({ version: 2, updatedAt: at.toISOString(), objects: {} })],
    ["bad entry", JSON.stringify({ version: 1, updatedAt: at.toISOString(), objects: { k: { size: -1 } } })],
  ])("refuses to start over from an unreadable manifest (%s)", async (_name, content) => {
    const storage = createMemoryStorage();
    await storage.put({ key: "manifest.json", body: Buffer.from(content), contentType: "application/json" });
    await expect(loadManifest(storage)).rejects.toBeInstanceOf(ManifestError);
  });
});
