/**
 * Health endpoint for Railway (the worker has no other inbound traffic): /healthz is liveness (no dependencies),
 * /readyz checks the database and the object store with a 2 s limit each and turns 503 while the worker drains.
 */
import { createServer, type Server } from "node:http";

export const READINESS_TIMEOUT_MS = 2000;

export type Check = "ok" | "fail";
export type Probe = () => Promise<unknown>;

/** Runs `probe`; "fail" when it rejects or takes longer than `timeoutMs` (the probe is abandoned, not cancelled). */
export async function runCheck(probe: Probe, timeoutMs: number): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Check>((resolve) => {
    timer = setTimeout(() => {
      resolve("fail");
    }, timeoutMs);
  });
  try {
    return await Promise.race([probe().then((): Check => "ok"), timeout]);
  } catch {
    return "fail";
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthOptions {
  readonly host: string;
  readonly port: number;
  readonly probes: Readonly<Record<string, Probe>>;
  /** True once shutdown has started: the worker is no longer ready, so it is taken out of rotation. */
  readonly isDraining: () => boolean;
  readonly timeoutMs?: number;
}

export interface HealthServer {
  /** The port actually bound (differs from the option when it was 0). */
  readonly port: number;
  close(): Promise<void>;
}

async function readiness(o: HealthOptions): Promise<{ code: number; body: string }> {
  const names = Object.keys(o.probes);
  const results = await Promise.all(
    names.map((name) =>
      runCheck(o.probes[name] ?? (() => Promise.reject(new Error("no probe"))), o.timeoutMs ?? READINESS_TIMEOUT_MS),
    ),
  );
  const checks: Record<string, Check> = Object.fromEntries(names.map((name, i) => [name, results[i] ?? "fail"]));
  const draining = o.isDraining();
  const ok = !draining && results.every((r) => r === "ok");
  return { code: ok ? 200 : 503, body: JSON.stringify({ status: ok ? "ok" : "degraded", draining, checks }) };
}

export function startHealthServer(o: HealthOptions): Promise<HealthServer> {
  const server: Server = createServer((req, res) => {
    const send = (code: number, body: string): void => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const path = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") send(405, '{"status":"method_not_allowed"}');
    else if (path === "/healthz") send(200, '{"status":"ok"}');
    else if (path === "/readyz") {
      void readiness(o).then(({ code, body }) => {
        send(code, body);
      });
    } else send(404, '{"status":"not_found"}');
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, o.host, () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : o.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}
