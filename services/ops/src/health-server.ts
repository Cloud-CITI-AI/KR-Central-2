/**
 * The migrate service's only endpoint. Railway health-checks it and the deploy script waits for it before starting the
 * api, so `GET /healthz` answers 200 only once migrations have succeeded: 503 while they run and after they failed.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type MigrateStatus = "migrating" | "ready" | "failed";

export interface HealthServerOptions {
  readonly host: string;
  readonly port: number;
  readonly release: string;
  readonly getStatus: () => MigrateStatus;
}

export interface HealthServer {
  /** The bound port (differs from the option when 0 was asked for). */
  readonly port: number;
  close(): Promise<void>;
}

export function startHealthServer(opts: HealthServerOptions): Promise<HealthServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/healthz") {
      res.writeHead(404, { "cache-control": "no-store" }).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" }).end();
      return;
    }
    const status = opts.getStatus();
    const body = JSON.stringify({ status, release: opts.release });
    res
      .writeHead(status === "ready" ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" })
      .end(req.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => {
              if (error) fail(error);
              else done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}
