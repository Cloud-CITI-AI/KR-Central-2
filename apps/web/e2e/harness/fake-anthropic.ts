import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** What the fake "reads" from every page 1: a synthetic stamp in the real reader's structured-output shape. */
export const FAKE_STAMP = { found: true, date: "2026-03-16", stampText: "DATE 16-Mar-2026 FILE 123-26" } as const;

export interface FakeAnthropic {
  readonly baseUrl: string;
  /** How many page images the worker has sent for reading. */
  readonly requests: () => number;
  stop(): Promise<void>;
}

/**
 * A stand-in for api.anthropic.com's POST /v1/messages that answers every request with the synthetic stamp. The worker's
 * real reader (page rendering, prompt, structured-output parsing) runs against it, so the stamp-reading path is exercised
 * without a key, without the network and without sending anything to Anthropic (ADR-0010, X7). The SDK honours
 * ANTHROPIC_BASE_URL, which is how the worker is pointed here.
 */
export async function startFakeAnthropic(): Promise<FakeAnthropic> {
  let count = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      count += 1;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: JSON.stringify(FAKE_STAMP) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port.toString()}`,
    requests: () => count,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
