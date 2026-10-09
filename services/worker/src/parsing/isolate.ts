/**
 * Runs untrusted-document parsing in a `worker_thread` with a heap cap and a hard time limit (ADR-0011): a decompression
 * bomb or a pathological PDF is stopped by `terminate()` or by V8's heap limit and fails the operation, never the worker.
 * The thread gets an empty environment, so it cannot see the database URL or any key.
 */
import { Worker } from "node:worker_threads";
import type { DocumentParseErrorCode } from "@kr/document-parsing";
import { TaskError } from "../errors.js";
import type { TaskInputs, TaskName, TaskOutputs, ThreadReply } from "./tasks.js";

export interface ParseLimits {
  /** Hard limit for one task (PRODUCT_SPEC §15: 60 s). */
  readonly timeoutMs: number;
  readonly maxOldGenerationSizeMb: number;
  readonly maxYoungGenerationSizeMb: number;
}

const MB = 1024 * 1024;
/** How often the parent checks the thread's memory (a tight allocation loop cannot outrun it for long). */
const MEMORY_SAMPLE_MS = 50;

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  timeoutMs: 60_000,
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 64,
};

/** Person-oriented failure text per code; the API shows its own wording for the codes it knows. */
const MESSAGES: Readonly<Record<string, string>> = {
  not_a_pdf: "That file is not a PDF, so it could not be read.",
  encrypted_pdf: "The PDF is password-protected, so it could not be read.",
  too_many_pages: "The PDF has too many pages to read.",
  unreadable_pdf: "The PDF could not be read. It may be damaged or a scanned image.",
  render_failed: "The first page of the PDF could not be read.",
  invalid_msg: "That file is not a readable Outlook message.",
  invalid_eml: "That file is not a readable email.",
  timeout: "Reading the document took too long. Try again.",
  too_complex: "The document is too large or complex to read.",
};

const DOCUMENT_CODES: ReadonlySet<string> = new Set<DocumentParseErrorCode>([
  "not_a_pdf",
  "encrypted_pdf",
  "too_many_pages",
  "unreadable_pdf",
  "render_failed",
  "invalid_msg",
  "invalid_eml",
]);

/** True when the failure says the document itself cannot be read (as opposed to a time or memory limit). */
export const isUnreadable = (error: unknown): error is TaskError =>
  error instanceof TaskError && DOCUMENT_CODES.has(error.code);

const FALLBACK = "The document could not be read.";
const failure = (code: string, cause?: unknown): TaskError =>
  new TaskError(code, MESSAGES[code] ?? FALLBACK, cause === undefined ? {} : { cause });

const SOURCE_MODE = import.meta.url.endsWith(".ts");
const DEFAULT_ENTRY = new URL(SOURCE_MODE ? "./thread.ts" : "./thread.js", import.meta.url);

/** Runs `request` in a fresh thread running `entry`; resolves with the thread's value. Test seam: `entry`. */
export function runInThread(
  request: unknown,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
  signal?: AbortSignal,
  entry: URL = DEFAULT_ENTRY,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : failure("timeout"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: request,
      env: {},
      // under vitest and `tsx` the thread is TypeScript source and resolves workspace packages to their source
      execArgv: SOURCE_MODE ? ["--conditions=@kr/source", "--import", "tsx"] : [],
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sampler);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      outcome();
    };
    const onAbort = (): void => {
      settle(() => {
        reject(signal?.reason instanceof Error ? signal.reason : failure("timeout"));
      });
    };
    const timer = setTimeout(() => {
      settle(() => {
        reject(failure("timeout"));
      });
    }, limits.timeoutMs);
    // V8's heap limit is ignored when the process was started with --max-old-space-size (NODE_OPTIONS), and it does not
    // count Buffers, so the parent also samples the thread: JS heap plus external memory over the cap ends it.
    const cap = (limits.maxOldGenerationSizeMb + limits.maxYoungGenerationSizeMb) * MB;
    const sampler = setInterval(() => {
      worker.getHeapStatistics().then(
        (heap) => {
          if (heap.used_heap_size + heap.external_memory <= cap) return;
          settle(() => {
            reject(failure("too_complex"));
          });
        },
        () => undefined,
      );
    }, MEMORY_SAMPLE_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: ThreadReply) => {
      settle(() => {
        if (message.ok) resolve(message.value);
        else reject(failure(message.code));
      });
    });
    worker.once("error", (error: NodeJS.ErrnoException) => {
      settle(() => {
        reject(failure(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "too_complex" : "parse_failed", error));
      });
    });
    worker.once("exit", () => {
      settle(() => {
        reject(failure("parse_failed"));
      });
    });
  });
}

export interface Parser {
  run<K extends TaskName>(task: K, input: TaskInputs[K], signal?: AbortSignal): Promise<TaskOutputs[K]>;
}

export function createParser(limits: ParseLimits = DEFAULT_PARSE_LIMITS): Parser {
  return {
    run: (task, input, signal) => runInThread({ task, ...input }, limits, signal) as Promise<never>,
  };
}
