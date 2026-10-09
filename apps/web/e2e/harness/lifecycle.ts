import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Process and container bookkeeping for the synthetic stack. Everything the harness starts is written to a run record in
 * the OS temp directory; a later run reaps the leftovers of a run whose owner died (SIGKILL, power loss), so a crashed run
 * never leaves containers or servers behind. A normal run tears down in reverse order of start.
 */

const RECORD_PREFIX = "kr-e2e-run-";
const OWNER_ENV = "KR_E2E_RUN";
export const CONTAINER_LABEL = "kr-e2e-run";

interface RunRecord {
  runId: string;
  ownerPid: number;
  pids: number[];
  containers: string[];
}

export function newRunId(): string {
  return randomBytes(4).toString("hex");
}

const recordPath = (runId: string): string => join(tmpdir(), `${RECORD_PREFIX}${runId}.json`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function belongsToRun(pid: number, runId: string): boolean {
  try {
    return readFileSync(`/proc/${pid.toString()}/environ`, "utf8").includes(`${OWNER_ENV}=${runId}`);
  } catch {
    return false;
  }
}

function docker(args: readonly string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Kill (process group, then process) and remove what a dead run left behind. Never touches a live owner's run. */
export function reapAbandonedRuns(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(RECORD_PREFIX) || !name.endsWith(".json")) continue;
    const file = join(tmpdir(), name);
    let record: RunRecord;
    try {
      record = JSON.parse(readFileSync(file, "utf8")) as RunRecord;
    } catch {
      continue;
    }
    if (alive(record.ownerPid)) continue;
    for (const pid of record.pids) {
      if (!belongsToRun(pid, record.runId)) continue;
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    for (const container of record.containers) {
      try {
        docker(["rm", "-f", container]);
      } catch {
        // already gone
      }
    }
    rmSync(file, { force: true });
  }
}

/** Reverse-order teardown plus the on-disk run record. */
export class RunScope {
  readonly runId = newRunId();
  private readonly record: RunRecord;
  private readonly tasks: { name: string; run: () => Promise<void> | void }[] = [];

  constructor() {
    this.record = { runId: this.runId, ownerPid: process.pid, pids: [], containers: [] };
    this.persist();
  }

  private persist(): void {
    writeFileSync(recordPath(this.runId), JSON.stringify(this.record));
  }

  onStop(name: string, run: () => Promise<void> | void): void {
    this.tasks.push({ name, run });
  }

  trackPid(pid: number): void {
    this.record.pids.push(pid);
    this.persist();
  }

  trackContainer(id: string): void {
    this.record.containers.push(id);
    this.persist();
  }

  /** Runs every teardown task (newest first) even when one fails; rethrows the failures together. */
  async stop(): Promise<void> {
    const failures: string[] = [];
    for (const task of this.tasks.splice(0).reverse()) {
      try {
        await task.run();
      } catch (error) {
        failures.push(`${task.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    rmSync(recordPath(this.runId), { force: true });
    if (failures.length > 0) throw new Error(`Teardown problems: ${failures.join("; ")}`);
  }
}

export interface ManagedProcess {
  readonly name: string;
  readonly logFile: string;
  readonly child: ChildProcess;
  /** True once the process has exited. */
  readonly exited: () => boolean;
  stop(): Promise<void>;
}

export interface SpawnOptions {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logDir: string;
}

/** Start a service in its own process group, with stdout and stderr in `<logDir>/<name>.log`. */
export function spawnService(scope: RunScope, options: SpawnOptions): ManagedProcess {
  mkdirSync(options.logDir, { recursive: true });
  const logFile = join(options.logDir, `${options.name}.log`);
  const fd = openSync(logFile, "a");
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, [OWNER_ENV]: scope.runId },
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  closeSync(fd);
  let done = false;
  child.once("exit", () => {
    done = true;
  });
  if (child.pid !== undefined) scope.trackPid(child.pid);
  const managed: ManagedProcess = {
    name: options.name,
    logFile,
    child,
    exited: () => done,
    async stop() {
      if (done || child.pid === undefined) return;
      const exit = new Promise<void>((resolve) => {
        child.once("exit", () => {
          resolve();
        });
      });
      const signal = (name: NodeJS.Signals): void => {
        try {
          process.kill(-(child.pid ?? 0), name);
        } catch {
          // group already gone
        }
      };
      signal("SIGTERM");
      const timer = setTimeout(() => {
        signal("SIGKILL");
      }, 8000);
      await exit;
      clearTimeout(timer);
    },
  };
  scope.onStop(`stop ${options.name}`, () => managed.stop());
  return managed;
}

export function logTail(file: string, lines = 25): string {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

export interface WaitOptions {
  readonly timeoutMs?: number;
  readonly process?: ManagedProcess;
  readonly accept?: (response: Response) => boolean;
}

/** Poll `url` until it answers (2xx by default); fails early, with the log tail, when the process died. */
export async function waitForHttp(url: string, options: WaitOptions = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let last = "no answer";
  while (Date.now() < deadline) {
    if (options.process?.exited()) {
      throw new Error(`${options.process.name} exited while starting.\n${logTail(options.process.logFile)}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if ((options.accept ?? ((r: Response) => r.ok))(response)) return;
      last = `HTTP ${response.status.toString()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const tail = options.process ? `\n${logTail(options.process.logFile)}` : "";
  throw new Error(`${url} did not become ready (${last}).${tail}`);
}

/** A free TCP port on 127.0.0.1 (the small race before the service binds it is accepted). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

export interface ContainerOptions {
  readonly image: string;
  readonly containerPort: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly mounts?: readonly { source: string; target: string }[];
}

export interface RunningContainer {
  readonly id: string;
  readonly host: string;
  readonly port: number;
}

/** `docker run` a container with one published port on 127.0.0.1; removed on teardown (and by the reaper after a crash). */
export function startContainer(scope: RunScope, options: ContainerOptions): RunningContainer {
  const args = [
    "run",
    "-d",
    "--rm",
    "--label",
    `${CONTAINER_LABEL}=${scope.runId}`,
    "-p",
    `127.0.0.1::${options.containerPort.toString()}`,
  ];
  for (const [key, value] of Object.entries(options.env ?? {})) args.push("-e", `${key}=${value}`);
  for (const mount of options.mounts ?? []) args.push("-v", `${mount.source}:${mount.target}:ro`);
  args.push(options.image);
  const id = docker(args);
  scope.trackContainer(id);
  scope.onStop(`remove container ${id.slice(0, 12)}`, () => {
    try {
      docker(["rm", "-f", id]);
    } catch {
      // --rm may have removed it already
    }
  });
  const mapped = docker(["port", id, `${options.containerPort.toString()}/tcp`]).split("\n")[0] ?? "";
  const port = Number(mapped.slice(mapped.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Could not read the published port of ${options.image}`);
  return { id, host: "127.0.0.1", port };
}
