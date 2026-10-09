// Bundle budgets for `pnpm perf:check` (after `pnpm build`). Chunk file names are hashes, so the entries are built from
// Next's own record of which chunks each route loads first (`.next/diagnostics/route-bundle-stats.json`) instead of a glob.
//
// Three budgets, each measured on its own, so a lazily loaded library (pdf.js, ~135 KB gzip, opened only in the document
// viewer) cannot hide a first-load regression and first-load growth cannot hide behind lazy chunks:
//   1. first-load JS, all routes together  (FE-9, unchanged 400 KB)
//   2. first-load JS of each route         (ratchet: FE-9 asks for 170 KB per route; the authenticated routes are at 238 to
//                                           251 kB gzip today, so this holds the line at 260 KB until that gap is closed)
//   3. lazy JS: chunks no route loads first (pdf.js ~136 KB, Next's ~40 KB polyfill script, small dynamic imports ~11 KB;
//      186 KB today, so 200 KB leaves room for one small lazy feature and flags a second large library)
import { readdirSync, readFileSync } from "node:fs";

const STATS = ".next/diagnostics/route-bundle-stats.json";
const CHUNKS = ".next/static/chunks";

let routes;
try {
  routes = JSON.parse(readFileSync(STATS, "utf8"));
} catch {
  throw new Error(`${STATS} not found: run \`pnpm --filter @kr/web build\` before perf:check`);
}

const firstLoad = [...new Set(routes.flatMap((route) => route.firstLoadChunkPaths))].filter((path) =>
  path.endsWith(".js"),
);

const loadedFirst = new Set(firstLoad);
const lazy = readdirSync(CHUNKS, { recursive: true, encoding: "utf8" })
  .map((file) => `${CHUNKS}/${file.replaceAll("\\", "/")}`)
  .filter((path) => path.endsWith(".js") && !loadedFirst.has(path));

export default [
  { name: "first-load JS, all routes together (gzip), FE-9", path: firstLoad, limit: "400 KB", gzip: true },
  ...routes.map((route) => ({
    name: `first-load JS of ${route.route} (gzip), ratchet toward FE-9 170 KB`,
    path: route.firstLoadChunkPaths.filter((path) => path.endsWith(".js")),
    limit: "260 KB",
    gzip: true,
  })),
  {
    name: "lazy JS, chunks no route loads first, e.g. pdf.js (gzip)",
    path: lazy,
    limit: "200 KB",
    gzip: true,
  },
];
