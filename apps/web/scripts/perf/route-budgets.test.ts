// Run from apps/web: pnpm exec vitest run -c scripts/perf/vitest.config.ts   (no build needed)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST_LOAD_BUDGET_BYTES,
  PDFJS_ENGINE_MARKERS,
  budgetProblems,
  evaluateRoutes,
  findPdfJsEngineChunks,
  limitFor,
  measureBuild,
  proveLazyPdfJs,
  unknownWaivers,
  type RouteStat,
} from "./route-budgets.ts";

const routes: RouteStat[] = [
  { route: "/", firstLoadChunkPaths: ["a.js", "b.js", "styles.css"] },
  { route: "/big", firstLoadChunkPaths: ["a.js", "huge.js"] },
  { route: "/gone", firstLoadChunkPaths: ["a.js"] },
];
const sizes: Record<string, number> = { "a.js": 100_000, "b.js": 70_000, "huge.js": 90_000, "styles.css": 999_999 };
const sizeOf = (path: string) => sizes[path] ?? 0;

describe("evaluateRoutes", () => {
  it("sums only .js files and accepts a route at exactly the budget", () => {
    const [root] = evaluateRoutes(routes, sizeOf, {});
    expect(root).toEqual({ route: "/", bytes: 170_000, limitBytes: FIRST_LOAD_BUDGET_BYTES, status: "ok" });
  });

  it("flags a route one byte over the budget", () => {
    const [root] = evaluateRoutes(routes, (p) => (p === "b.js" ? 70_001 : sizeOf(p)), {});
    expect(root?.status).toBe("over");
  });

  it("holds a waived route to its ceiling: waived at or under it, over above it", () => {
    expect(evaluateRoutes(routes, sizeOf, { "/big": 190_000 })[1]?.status).toBe("waived");
    expect(evaluateRoutes(routes, sizeOf, { "/big": 189_999 })[1]?.status).toBe("over");
  });

  it("reports a waiver on a route that fits the budget as stale", () => {
    expect(evaluateRoutes(routes, sizeOf, { "/": 200_000 })[0]?.status).toBe("stale-waiver");
  });
});

describe("limitFor and unknownWaivers", () => {
  it("falls back to the FE-9 budget and finds waivers for routes that no longer exist", () => {
    expect(limitFor("/x", {})).toBe(170_000);
    expect(limitFor("/x", { "/x": 1 })).toBe(1);
    expect(unknownWaivers(routes, { "/big": 1, "/old": 2 })).toEqual(["/old"]);
  });
});

describe("pdf.js lazy proof", () => {
  const files: Record<string, string> = {
    "a.js": 'const viewer = "/pdfjs/pdf.worker.min.mjs";',
    "huge.js": `const d="${PDFJS_ENGINE_MARKERS[0]}";`,
    "lazy.js": `const e="${PDFJS_ENGINE_MARKERS[1]}";`,
  };
  const read = (path: string) => files[path] ?? "";

  it("recognises the engine by its markers and not the adapter that only names the worker path", () => {
    expect(findPdfJsEngineChunks(["a.js", "huge.js", "lazy.js"], read)).toEqual(["huge.js", "lazy.js"]);
  });

  it("names the routes that load an engine chunk first", () => {
    const proof = proveLazyPdfJs(routes, ["a.js", "huge.js", "lazy.js"], read);
    expect(proof.routesLoadingPdfJs).toEqual([{ route: "/big", chunks: ["huge.js"] }]);
  });
});

describe("budgetProblems", () => {
  const lazyOnly = { engineChunks: ["lazy.js"], routesLoadingPdfJs: [] };

  it("is empty for a build inside its budgets", () => {
    expect(budgetProblems(evaluateRoutes(routes.slice(0, 1), sizeOf, {}), lazyOnly, [])).toEqual([]);
  });

  it("reports an over-budget route, a stale waiver, a waiver for a missing route and a pdf.js in the first load", () => {
    const results = [
      { route: "/a", bytes: 5, limitBytes: 1, status: "over" as const },
      { route: "/b", bytes: 5, limitBytes: 9, status: "stale-waiver" as const },
    ];
    const proof = { engineChunks: ["huge.js"], routesLoadingPdfJs: [{ route: "/a", chunks: ["huge.js"] }] };
    const problems = budgetProblems(results, proof, ["/old"]);
    expect(problems.length).toBe(4);
    expect(problems[0]).toMatch(/\/a: 5 B .* over its 1 B limit/);
    expect(problems[1]).toMatch(/\/b: .* remove its entry/);
    expect(problems[2]).toMatch(/\/old: BUDGET_WAIVERS/);
    expect(problems[3]).toMatch(/\/a: pdf\.js is in its first load \(huge\.js\)/);
  });

  it("refuses to pass when the pdf.js markers match no chunk", () => {
    const problems = budgetProblems([], { engineChunks: [], routesLoadingPdfJs: [] }, []);
    expect(problems[0]).toMatch(/MARKERS are stale/);
  });
});

describe("measureBuild", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fakeBuild(first: string[], chunks: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "wp22-budgets-"));
    dirs.push(root);
    mkdirSync(join(root, ".next/diagnostics"), { recursive: true });
    mkdirSync(join(root, ".next/static/chunks"), { recursive: true });
    for (const [name, content] of Object.entries(chunks))
      writeFileSync(join(root, ".next/static/chunks", name), content);
    const stats = [{ route: "/", firstLoadChunkPaths: first.map((name) => `.next/static/chunks/${name}`) }];
    writeFileSync(join(root, ".next/diagnostics/route-bundle-stats.json"), JSON.stringify(stats));
    return root;
  }

  it("measures a build on disk and proves pdf.js lazy", () => {
    const root = fakeBuild(["app.js"], { "app.js": "x".repeat(2000), "engine.js": PDFJS_ENGINE_MARKERS[0]! });
    const build = measureBuild(root, {});
    expect(build.results[0]?.status).toBe("ok");
    expect(build.proof.engineChunks).toEqual([".next/static/chunks/engine.js"]);
    expect(budgetProblems(build.results, build.proof, build.staleRoutes)).toEqual([]);
  });

  it("fails when the engine is in a route's first load", () => {
    const root = fakeBuild(["engine.js"], { "engine.js": PDFJS_ENGINE_MARKERS[0]! });
    const build = measureBuild(root, {});
    expect(budgetProblems(build.results, build.proof, build.staleRoutes).join("\n")).toMatch(
      /pdf\.js is in its first load/,
    );
  });

  it("explains a missing build", () => {
    expect(() => measureBuild(join(tmpdir(), "wp22-no-such-build"), {})).toThrow(/run `pnpm --filter @kr\/web build`/);
  });
});
