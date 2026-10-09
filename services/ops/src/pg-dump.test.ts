import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDumpError, dumpToStorage } from "./pg-dump.js";

const URL_WITH_SECRET = "postgres://tracker_migrator:s3cret-pass@db.internal:5432/tracker";
let dir = "";

/** A stand-in pg_dump: a shell script, so the real spawn, stdio and exit-code handling are exercised. */
async function fakePgDump(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kr-ops-pgdump-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function dump(pgDumpPath: string, storage = createMemoryStorage()) {
  const result = dumpToStorage({
    storage,
    key: "db/pre-migrate/20261009T070102Z-dev.dump",
    pgDumpPath,
    databaseUrl: URL_WITH_SECRET,
    ssl: false,
  });
  return { storage, result };
}

async function readText(storage: ReturnType<typeof createMemoryStorage>): Promise<string> {
  const object = await storage.get("db/pre-migrate/20261009T070102Z-dev.dump");
  const chunks: Buffer[] = [];
  for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe("dumpToStorage", () => {
  it("stores what pg_dump writes to stdout once it exits 0", async () => {
    const script = await fakePgDump("ok", 'printf "PGDMP"; head -c 100000 /dev/zero | tr "\\0" "x"');
    const { storage, result } = dump(script);
    const stored = await result;
    expect(stored.size).toBe(100_005);
    const object = await storage.get("db/pre-migrate/20261009T070102Z-dev.dump");
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("PGDMP");
    expect(object.contentType).toBe("application/octet-stream");
  });

  it("passes the custom-format flags and exactly the libpq variables, with the password only in the environment", async () => {
    const script = await fakePgDump(
      "env",
      'echo "args=$*"; echo "pw=$PGPASSWORD host=$PGHOST user=$PGUSER db=$PGDATABASE leak=${KR_OPS_TEST_LEAK:-absent}"',
    );
    process.env.KR_OPS_TEST_LEAK = "should-not-reach-the-child";
    try {
      const { storage, result } = dump(script);
      await result;
      const text = await readText(storage);
      expect(text).toContain("args=--format=custom --no-password --lock-wait-timeout=30s");
      expect(text).toContain("pw=s3cret-pass host=db.internal user=tracker_migrator db=tracker leak=absent");
      expect(text.split("args=")[1]?.split("\n")[0]).not.toContain("s3cret-pass");
    } finally {
      delete process.env.KR_OPS_TEST_LEAK;
    }
  });

  it("stores nothing and reports the exit code when pg_dump fails after writing output", async () => {
    const script = await fakePgDump(
      "fail",
      'printf "PGDMP-partial"; echo "pg_dump: error: permission denied" >&2; exit 3',
    );
    const { storage, result } = dump(script);
    await expect(result).rejects.toMatchObject({
      name: "PgDumpError",
      message: expect.stringContaining("exit 3") as unknown,
      stderr: expect.stringContaining("permission denied") as unknown,
    });
    expect(await storage.exists("db/pre-migrate/20261009T070102Z-dev.dump")).toBe(false);
  });

  it("rejects when pg_dump cannot be started", async () => {
    const { storage, result } = dump(join(dir, "does-not-exist"));
    await expect(result).rejects.toBeInstanceOf(PgDumpError);
    await expect(result).rejects.toThrow(/could not run pg_dump/);
    expect(await storage.exists("db/pre-migrate/20261009T070102Z-dev.dump")).toBe(false);
  });

  it("rejects an empty dump", async () => {
    const script = await fakePgDump("empty", "exit 0");
    const { result } = dump(script);
    await expect(result).rejects.toThrow(/no output/);
  });

  it("reports a pg_dump killed by a signal", async () => {
    const script = await fakePgDump("killed", "kill -KILL $$");
    const { result } = dump(script);
    await expect(result).rejects.toThrow(/signal SIGKILL/);
  });
});
