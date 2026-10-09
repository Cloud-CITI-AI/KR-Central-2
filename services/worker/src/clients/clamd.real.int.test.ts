import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EICAR, startRealClamd, type RealClamd } from "../../test/clamav.js";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { fileRow, handlerContext, insertFile } from "../../test/files.js";
import { fileScanHandler } from "../handlers/file-scan.js";
import { ClamdError, createClamdClient } from "./clamd.js";

const MIB = 1024 * 1024;
let clamd: RealClamd;
let db: Db;
let jobId: string;

beforeAll(async () => {
  [clamd, db] = [await startRealClamd(), openDb()];
  jobId = await insertJob(db);
});
afterAll(async () => {
  await clamd.stop();
  await db.destroy();
});

const client = (maxBytes = 60 * MIB) =>
  createClamdClient({ host: clamd.host, port: clamd.port, timeoutMs: 60_000, maxBytes });

/** A synthetic file of `bytes` random bytes, produced a MiB at a time (never held whole in memory). */
function synthetic(bytes: number): Readable {
  const block = randomBytes(MIB);
  return Readable.from(
    (function* () {
      for (let sent = 0; sent < bytes; sent += MIB) yield block.subarray(0, Math.min(MIB, bytes - sent));
    })(),
  );
}

describe("the real clamd with infra/clamav/clamd.conf", () => {
  it("answers PING", async () => {
    expect(await client().ping()).toBe(true);
  });

  it("detects the EICAR test string", async () => {
    const verdict = await client().scan(Readable.from([Buffer.from(EICAR)]));
    expect(verdict.status).toBe("infected");
    expect(verdict).toMatchObject({ signature: expect.stringMatching(/EICAR/i) as string });
  });

  it("scans a 55 MB synthetic file without error (more than clamd's 25M default)", { timeout: 150_000 }, async () => {
    expect(await client().scan(synthetic(55 * MIB))).toEqual({ status: "clean" });
  });

  it("refuses a stream over StreamMaxLength (60M) instead of scanning part of it", { timeout: 150_000 }, async () => {
    const error = await client(70 * MIB)
      .scan(synthetic(61 * MIB))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClamdError);
    // clamd answers "size limit exceeded" and closes while the client is still sending; depending on timing the reply
    // is read (size_limit) or lost to the connection reset (connection). Either way there is no verdict, never "clean".
    expect(["size_limit", "connection"]).toContain((error as ClamdError).code);
  });

  it(
    "file.scan marks the 55 MB file clean and an EICAR upload infected, deleted and audited",
    { timeout: 150_000 },
    async () => {
      const storage = createMemoryStorage();
      const metrics = { recordFileScan: vi.fn() };
      const handler = fileScanHandler({
        db,
        storage,
        clamd: client(),
        config: { MALWARE_SCAN_MODE: "required", CLAMAV_TIMEOUT_MS: 60_000, SCAN_ERROR_MAX_RETRIES: 3 },
        metrics,
      });
      const big = await insertFile(db, storage, jobId, { bytes: randomBytes(55 * MIB) });
      const bad = await insertFile(db, storage, jobId, { bytes: EICAR });
      for (const file of [big, bad]) {
        const op = await enqueue(db, jobId, "file.scan", { fileId: file.id });
        await handler.run(handlerContext(op));
      }
      expect((await fileRow(db, big.id)).scan_status).toBe("clean");
      expect(await storage.exists(big.key)).toBe(true);
      const row = await fileRow(db, bad.id);
      expect(row.scan_status).toBe("infected");
      expect(row.scan_detail).toMatch(/EICAR/i);
      expect(await storage.exists(bad.key)).toBe(false);
      const audit = await db.selectFrom("audit_events").select("actor_type").where("entity_id", "=", bad.id).execute();
      expect(audit).toEqual([{ actor_type: "system" }]);
      expect(metrics.recordFileScan.mock.calls).toEqual([["clean"], ["infected"]]);
    },
  );
});
