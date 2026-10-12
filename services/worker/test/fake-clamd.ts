import net from "node:net";

export interface FakeClamd {
  readonly port: number;
  /** Frames seen on the last INSTREAM: payload sizes, and whether the zero-length terminator arrived. */
  readonly frames: number[];
  terminated(): boolean;
  stop(): Promise<void>;
}

export interface FakeBehaviour {
  /** What to do once the stream ended (or the limit hit). Default: scan for the marker. */
  readonly reply?: "silent" | "garbage" | "scanner-error" | "empty-close" | "limit-exceeded";
  /** Answer "INSTREAM size limit exceeded. ERROR" and close once more than this many bytes arrived. */
  readonly streamLimit?: number;
  /** Pause reading for this long after each chunk, to exercise backpressure. */
  readonly slowMs?: number;
  /** Listen on this port instead of a free one (a scanner that comes back where it was). */
  readonly port?: number;
}

/** The marker a test body includes to be reported infected (stands in for a signature; no real malware string needed). */
export const FAKE_VIRUS = "FAKE-VIRUS-MARKER";

/** A tiny clamd: understands zPING and zINSTREAM framing, and answers like clamd does. */
export function startFakeClamd(behaviour: FakeBehaviour = {}): Promise<FakeClamd> {
  const frames: number[] = [];
  let terminated = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let started = false;
    let seen = 0;
    let found = false;
    socket.on("error", () => undefined);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!started) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        const command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === "zPING") return void socket.end("PONG\0");
        started = true;
        frames.length = 0;
        terminated = false;
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (size === 0) {
          terminated = true;
          const reply = behaviour.reply;
          if (reply === "silent") return;
          if (reply === "empty-close") return void socket.end();
          if (reply === "garbage") return void socket.end("what is this\0");
          if (reply === "limit-exceeded")
            return void socket.end("stream: Heuristics.Limits.Exceeded.MaxRecursion FOUND\0");
          if (reply === "scanner-error") return void socket.end("stream: Can't allocate memory. ERROR\0");
          return void socket.end(found ? "stream: Fake.Virus-1 FOUND\0" : "stream: OK\0");
        }
        if (buffer.length < 4 + size) return;
        const payload = buffer.subarray(4, 4 + size);
        buffer = buffer.subarray(4 + size);
        frames.push(size);
        seen += size;
        found ||= payload.includes(FAKE_VIRUS);
        if (behaviour.streamLimit !== undefined && seen > behaviour.streamLimit) {
          return void socket.end("INSTREAM size limit exceeded. ERROR\0");
        }
        if (behaviour.slowMs) {
          socket.pause();
          setTimeout(() => socket.resume(), behaviour.slowMs);
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(behaviour.port ?? 0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        frames,
        terminated: () => terminated,
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
            for (const socket of sockets) socket.destroy();
          }),
      });
    });
  });
}
