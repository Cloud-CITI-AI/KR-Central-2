import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeAnthropic {
  readonly baseURL: string;
  /** Request bodies (parsed JSON) and headers seen so far. */
  readonly requests: { body: Record<string, unknown>; headers: IncomingMessage["headers"] }[];
  /** Change what the next requests are answered with (a service that recovers). */
  respondWith(next: Reply): void;
  stop(): Promise<void>;
}

export type Reply = { text: string; stopReason?: string } | { status: number } | "hang";

/** A local stand-in for api.anthropic.com's POST /v1/messages that answers with the canned reply. */
export async function startFakeAnthropic(initial: Reply): Promise<FakeAnthropic> {
  let reply = initial;
  const requests: FakeAnthropic["requests"] = [];
  const sockets = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        headers: req.headers,
      });
      if (reply === "hang") {
        sockets.add(res);
        return;
      }
      res.setHeader("content-type", "application/json");
      if ("status" in reply) {
        res.statusCode = reply.status;
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "no" } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: reply.text === "" ? [] : [{ type: "text", text: reply.text }],
          stop_reason: reply.stopReason ?? "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    respondWith: (next) => {
      reply = next;
    },
    stop: () =>
      new Promise<void>((done) => {
        for (const res of sockets) res.destroy();
        server.close(() => {
          done();
        });
        server.closeAllConnections();
      }),
  };
}
