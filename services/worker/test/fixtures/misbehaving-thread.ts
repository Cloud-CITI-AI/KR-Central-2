/** A stand-in parse thread that misbehaves on request, to test the isolation limits. */
import { parentPort, workerData } from "node:worker_threads";

const mode = (workerData as { mode: string }).mode;

if (mode === "loop") {
  for (;;) {
    // never yields: only terminate() stops it
  }
} else if (mode === "alloc") {
  const hoard: number[][] = [];
  for (;;) hoard.push(new Array<number>(1_000_000).fill(1));
} else if (mode === "buffers") {
  // off-heap memory: V8's heap limit does not see it
  const hoard: Buffer[] = [];
  for (;;) hoard.push(Buffer.alloc(10_000_000, 1));
} else if (mode === "env") {
  parentPort?.postMessage({ ok: true, value: Object.keys(process.env) });
} else if (mode === "exit") {
  process.exit(3);
}
