/**
 * Streams `pg_dump --format=custom` straight into the backup bucket (no temp file, so no disk sizing and no dump left
 * behind). The object is only completed when pg_dump exits 0: the body stream stays open until the exit code is known and
 * fails the upload when it is not 0, so a truncated dump is never stored.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import type { ObjectStorage, PutObjectResult } from "@kr/storage";
import { pgEnv } from "./pg-url.js";

const STDERR_TAIL_CHARS = 2_000;

export class PgDumpError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PgDumpError";
  }
}

export interface DumpOptions {
  readonly storage: Pick<ObjectStorage, "put" | "head">;
  readonly key: string;
  readonly pgDumpPath: string;
  readonly databaseUrl: string;
  readonly ssl: boolean;
}

type DumpProcess = ChildProcessByStdio<null, Readable, Readable>;

function bodyOf(child: DumpProcess): Readable {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    stderr = (stderr + text).slice(-STDERR_TAIL_CHARS);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", (cause) => {
      reject(new PgDumpError(`could not run pg_dump: ${cause.message}`, stderr, { cause }));
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  exited.catch(() => undefined); // surfaced below, once the stream is read; this only prevents an unhandled rejection

  async function* chunks(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of child.stdout) yield chunk as Buffer;
      const { code, signal } = await exited;
      if (code !== 0) {
        throw new PgDumpError(
          `pg_dump failed (${code === null ? `signal ${String(signal)}` : `exit ${code}`})`,
          stderr,
        );
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); // the upload failed first
    }
  }
  return Readable.from(chunks(), { objectMode: false });
}

/** Dumps the database into `key`. Rejects, storing nothing, when pg_dump or the upload fails or the dump is empty. */
export async function dumpToStorage(opts: DumpOptions): Promise<PutObjectResult> {
  const child = spawn(opts.pgDumpPath, ["--format=custom", "--no-password", "--lock-wait-timeout=30s"], {
    env: pgEnv(opts.databaseUrl, opts.ssl), // exactly these variables: nothing else from this process leaks into the child
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stored = await opts.storage.put({
    key: opts.key,
    body: bodyOf(child),
    contentType: "application/octet-stream",
  });
  if (stored.size === 0) throw new PgDumpError("pg_dump produced no output", "");
  const head = await opts.storage.head(opts.key);
  if (head.size !== stored.size) {
    throw new PgDumpError(`stored dump is ${head.size} bytes, expected ${stored.size}`, "");
  }
  return stored;
}
