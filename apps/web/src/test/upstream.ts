/** A real local HTTP server standing in for the API in server-side tests (no mocks of fetch: real sockets and streams). */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Upstream {
  readonly url: string;
  /** Headers of the last request the server saw (lower-cased names). */
  readonly seen: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[];
  close(): Promise<void>;
}

export async function startUpstream(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Upstream> {
  const seen: Upstream["seen"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: "" };
    seen.push(entry);
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      entry.body = Buffer.concat(chunks).toString("utf8");
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
