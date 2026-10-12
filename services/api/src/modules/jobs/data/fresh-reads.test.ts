import { describe, expect, it } from "vitest";
import { FreshReads } from "./job-cards.js";

/** A read that records when it starts and ends, and finishes when the test says so. */
function controlledRead() {
  let started = 0;
  let overlapping = 0;
  let maxOverlap = 0;
  const gates: (() => void)[] = [];
  const read = (label: string) => () => {
    started += 1;
    overlapping += 1;
    maxOverlap = Math.max(maxOverlap, overlapping);
    const startedAt = started;
    return new Promise<string>((resolve) => {
      gates.push(() => {
        overlapping -= 1;
        resolve(`${label}#${startedAt.toString()}`);
      });
    });
  };
  const release = async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { read, release, started: () => started, maxOverlap: () => maxOverlap };
}

describe("FreshReads", () => {
  it("lets callers arriving during a read share the one read that starts after it, never overlapping", async () => {
    const reads = new FreshReads<string>();
    const c = controlledRead();
    const first = reads.fresh("k", c.read("r"));
    const late = Array.from({ length: 9 }, () => reads.fresh("k", c.read("r")));
    expect(c.started()).toBe(1);
    await c.release();
    expect(await first).toBe("r#1");
    expect(c.started()).toBe(2);
    await c.release();
    expect(await Promise.all(late)).toEqual(Array(9).fill("r#2"));
    expect(c.started()).toBe(2);
    expect(c.maxOverlap()).toBe(1);
  });

  it("never serves a call with a read that started before it (a write before the call is in the result)", async () => {
    const reads = new FreshReads<number>();
    let database = 0;
    const read = () => {
      const seen = database;
      return new Promise<number>((resolve) =>
        setTimeout(() => {
          resolve(seen);
        }, 5),
      );
    };
    const running = reads.fresh("k", read);
    database = 1; // committed after the running read took its snapshot, before the next call
    const afterWrite = reads.fresh("k", read);
    expect(await running).toBe(0);
    expect(await afterWrite).toBe(1);
  });

  it("keeps keys apart and forgets a key once its reads are done", async () => {
    const reads = new FreshReads<string>();
    const [a, b] = [controlledRead(), controlledRead()];
    const [ra, rb] = [reads.fresh("a", a.read("a")), reads.fresh("b", b.read("b"))];
    expect([a.started(), b.started()]).toEqual([1, 1]);
    expect(reads.size).toBe(2);
    await a.release();
    await b.release();
    expect([await ra, await rb]).toEqual(["a#1", "b#1"]);
    expect(reads.size).toBe(0);
  });

  it("reports a failed read to the callers of that read only; the callers queued behind it get their own read", async () => {
    const reads = new FreshReads<string>();
    let fail = true;
    const read = () =>
      new Promise<string>((resolve, reject) =>
        setTimeout(() => {
          if (fail) {
            fail = false;
            reject(new Error("boom"));
          } else resolve("ok");
        }, 5),
      );
    const failing = reads.fresh("k", read);
    const queued = reads.fresh("k", read);
    await expect(failing).rejects.toThrow("boom");
    expect(await queued).toBe("ok");
    expect(reads.size).toBe(0);
  });
});
