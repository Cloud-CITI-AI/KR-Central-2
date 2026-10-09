import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METRIC_NAMES } from "./metrics.js";

// Keeps the SLO and alert docs consistent with the code and with the runbook list WP-21 writes against.
const read = (path: string): string => readFileSync(new URL(`../../../docs/${path}`, import.meta.url), "utf8");
const slo = read("slo.md");
const alerts = read("observability/alerts.md");
const dashboards = read("observability/dashboards.md");

const RUNBOOKS = [
  "api-availability",
  "api-latency",
  "worker-queue-backlog",
  "operation-failures",
  "malware-detected",
  "malware-scan-errors",
  "clamav-down",
  "auth-failure-spike",
  "migrate-failed",
  "backup-failed",
  "db-connections-saturated",
];

describe("docs/observability/alerts.md", () => {
  it("links exactly the fixed runbook list, each once in the index and once in its alert section", () => {
    const links = [...alerts.matchAll(/\(\.\.\/runbooks\/([a-z-]+)\.md\)/g)].map((m) => m[1]);
    expect([...new Set(links)].sort()).toEqual([...RUNBOOKS].sort());
    for (const name of RUNBOOKS) expect(links.filter((l) => l === name)).toHaveLength(2);
  });

  it("has one section per runbook name and no others", () => {
    const sections = [...alerts.matchAll(/^## ([a-z-]+)$/gm)].map((m) => m[1]);
    expect([...sections].sort()).toEqual([...RUNBOOKS].sort());
  });
});

describe("metric names in the docs", () => {
  it.each([
    ["slo.md", slo],
    ["alerts.md", alerts],
    ["dashboards.md", dashboards],
  ])("%s only mentions metrics that createMetrics registers", (_name, text) => {
    const known = new Set<string>(Object.values(METRIC_NAMES));
    const mentioned = new Set(text.match(/\bkr\.[a-z]+\.[a-z_]+/g) ?? []);
    expect([...mentioned].filter((m) => !known.has(m))).toEqual([]);
  });

  it("covers every business metric somewhere in the alert or SLO docs", () => {
    for (const name of Object.values(METRIC_NAMES)) expect(slo + alerts).toContain(name);
  });
});

describe("docs/slo.md", () => {
  it("states the objectives from PRODUCT_SPEC §14 and the brief", () => {
    for (const text of ["99.5 %", "p95 < 300 ms", "p99 < 800 ms", "p95 < 1 s", "under 2 min", "10 min"]) {
      expect(slo).toContain(text);
    }
    expect(slo).toMatch(/Scan backlog/);
  });

  it("is referenced by the alert and dashboard docs", () => {
    expect(alerts).toContain("../slo.md");
    expect(dashboards).toContain("../slo.md");
  });
});
