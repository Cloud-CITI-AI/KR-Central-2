// Bundle budgets for `pnpm perf:check` (after `pnpm build`). Chunk file names are hashes, so the entries are built from
// Next's own record of which chunks each route loads first (`.next/diagnostics/route-bundle-stats.json`) instead of a glob.
// The method, the waivers and the pdf.js proof live in scripts/perf/route-budgets.ts.
//
// Three budgets, each measured on its own, so a lazily loaded library (pdf.js, ~135 KB gzip, opened only in the document
// viewer) cannot hide a first-load regression and first-load growth cannot hide behind lazy chunks:
//   1. first-load JS, all routes together  (FE-9; every route is within 170 KB, so the union of their first loads is held to
//                                           170 KB too: 167.5 KB today)
//   2. first-load JS of each route         (FE-9: 170 KB gzip; a route over it is held to its BUDGET_WAIVERS ceiling, which
//                                           only ratchets down; there are none today and the public routes can have none)
//   3. lazy JS: chunks no route loads first (pdf.js 135 KB, Zod with the contract schemas for the forms that validate with
//      them, the viewer dialog, the tracker body, the dashboard content and the admin pages, Next's polyfill script;
//      305.8 KB today (it was 303.7 KB before the round-2 edit fixes: draft restore for the forms, the 503 and 429
//      wording, and SignInLink now live in lazy chunks). It was 235.6 KB while those pages were in the first loads: the
//      code moved here, it did not grow, and the first-load union fell from 239.8 to 167.5 KB. 307 KB leaves room for one
//      small lazy feature, and a second large library still trips it)
// Besides sizes, loading this file fails the check when a waiver is stale or pdf.js is in any route's first load.
import { budgetProblems, jsOnly, limitFor, measureBuild } from "./scripts/perf/route-budgets.ts";

const { routes, results, proof, staleRoutes, allChunks } = measureBuild();

// Sizes over a limit are reported by size-limit itself; everything else that fails the budgets is thrown here.
const problems = budgetProblems(
  results.filter((result) => result.status !== "over"),
  proof,
  staleRoutes,
);
if (problems.length > 0) throw new Error(`Route budget problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

const firstLoad = [...new Set(routes.flatMap((route) => jsOnly(route.firstLoadChunkPaths)))];
const loadedFirst = new Set(firstLoad);
const lazy = allChunks.filter((path) => !loadedFirst.has(path));

export default [
  { name: "first-load JS, all routes together (gzip), FE-9 170 KB", path: firstLoad, limit: "170 KB", gzip: true },
  ...results.map(({ route, status }) => ({
    name: `first-load JS of ${route} (gzip), FE-9 170 KB${status === "waived" ? ", WAIVED to its ceiling" : ""}`,
    path: jsOnly(routes.find((r) => r.route === route)?.firstLoadChunkPaths ?? []),
    limit: `${limitFor(route) / 1000} KB`,
    gzip: true,
  })),
  {
    name: "lazy JS, chunks no route loads first, e.g. pdf.js (gzip)",
    path: lazy,
    limit: "307 KB",
    gzip: true,
  },
];
