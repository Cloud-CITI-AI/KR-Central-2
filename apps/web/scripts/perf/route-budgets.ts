// Per-route first-load JS budget (PRODUCT_SPEC section 14, FE-9: 170 KB gzip per route) computed from the Next build.
//
// Method. `next build` writes `.next/diagnostics/route-bundle-stats.json`: for every route, the chunk files the browser
// loads before the route is interactive. A route's size is the sum, over those `.js` files, of each file's own gzip size
// at level 9, which is exactly what `size-limit` (@size-limit/file, `gzip: true`) reports, so `pnpm perf:check` and
// `node scripts/perf/check-route-budgets.ts` print the same numbers. `170 KB` is size-limit's unit (1 KB = 1000 bytes),
// the stricter reading. Chunk names are content hashes, so budgets key on the route, never on a file name.
//
// pdf.js is proven lazy by content, not by name: the pdf.js engine chunk is found by markers that only the engine
// contains, and it must be absent from every route's first-load set (and present among the lazy chunks, otherwise the
// markers are stale and the proof would pass vacuously).
//
// Pure functions take their file access as arguments so they are unit-tested without a build (route-budgets.test.ts).
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { z } from "zod";

export const STATS_PATH = ".next/diagnostics/route-bundle-stats.json";
export const CHUNKS_DIR = ".next/static/chunks";

/** FE-9 / PRODUCT_SPEC section 14: first-load JS per route, gzip. */
export const FIRST_LOAD_BUDGET_BYTES = 170_000;

/** Strings that appear in the pdf.js engine (pdfjs-dist) and not in the viewer's small adapter chunk. */
export const PDFJS_ENGINE_MARKERS: readonly string[] = ["pdfjs_internal_id_", "pdfjs_internal_editor_"];

/**
 * Routes that may exceed the FE-9 budget, each with the ceiling it may not grow past (gzip bytes). None today: every route is
 * within 170 KB. A waiver is a ratchet: it is for a route that cannot fit and must be lowered as the route shrinks, a waiver on a
 * route that already fits fails the check (so none is left behind), and the public routes (PUBLIC_ROUTES) never get one.
 *
 * History: the signed-in routes were 200 to 218 KB behind waivers; FIX-R1-WEBCLIENT removed Zod and the contract schemas from
 * them, and FIX-R2-PERF-WEB the rest (the viewer dialog, the tracker body, the dashboard content and the admin pages are
 * lazy chunks; the root not-found no longer carries the signed-in shell).
 */
export const BUDGET_WAIVERS: Readonly<Record<string, number>> = {};

/** The pages a person sees before signing in, and the root 404: every first visit loads them, so they are never waived. */
export const PUBLIC_ROUTES: readonly string[] = ["/_not-found", "/sign-in", "/sign-in-error", "/signed-out"];

const routeStatsSchema = z.array(z.object({ route: z.string(), firstLoadChunkPaths: z.array(z.string()) }));
export type RouteStat = z.infer<typeof routeStatsSchema>[number];

export function parseRouteStats(json: unknown): RouteStat[] {
  return routeStatsSchema.parse(json);
}

export function jsOnly(paths: readonly string[]): string[] {
  return paths.filter((path) => path.endsWith(".js"));
}

export function gzipBytes(content: Buffer): number {
  return gzipSync(content, { level: 9 }).length;
}

export type RouteStatus = "ok" | "waived" | "over" | "stale-waiver";

export interface RouteResult {
  readonly route: string;
  readonly bytes: number;
  /** The limit this route is held to: the FE-9 budget, or its waiver ceiling. */
  readonly limitBytes: number;
  readonly status: RouteStatus;
}

export function limitFor(route: string, waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS): number {
  return waivers[route] ?? FIRST_LOAD_BUDGET_BYTES;
}

export function evaluateRoutes(
  routes: readonly RouteStat[],
  sizeOf: (path: string) => number,
  waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS,
): RouteResult[] {
  return routes.map(({ route, firstLoadChunkPaths }) => {
    const bytes = jsOnly(firstLoadChunkPaths).reduce((sum, path) => sum + sizeOf(path), 0);
    const limitBytes = limitFor(route, waivers);
    const waived = route in waivers;
    const status: RouteStatus =
      bytes > limitBytes ? "over" : !waived ? "ok" : bytes <= FIRST_LOAD_BUDGET_BYTES ? "stale-waiver" : "waived";
    return { route, bytes, limitBytes, status };
  });
}

export function unknownWaivers(
  routes: readonly RouteStat[],
  waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS,
): string[] {
  const known = new Set(routes.map((r) => r.route));
  return Object.keys(waivers).filter((route) => !known.has(route));
}

/** Public routes that hold a waiver: must be empty (they are the first thing every visitor loads). */
export function waivedPublicRoutes(waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS): string[] {
  return PUBLIC_ROUTES.filter((route) => route in waivers);
}

export function findPdfJsEngineChunks(
  files: readonly string[],
  read: (path: string) => string,
  markers: readonly string[] = PDFJS_ENGINE_MARKERS,
): string[] {
  return files.filter((path) => {
    const content = read(path);
    return markers.some((marker) => content.includes(marker));
  });
}

export interface PdfJsLazyProof {
  readonly engineChunks: string[];
  /** Routes whose first load contains a pdf.js engine chunk: must be empty. */
  readonly routesLoadingPdfJs: { route: string; chunks: string[] }[];
}

export function proveLazyPdfJs(
  routes: readonly RouteStat[],
  allChunks: readonly string[],
  read: (path: string) => string,
): PdfJsLazyProof {
  const engineChunks = findPdfJsEngineChunks(allChunks, read);
  const engine = new Set(engineChunks);
  const routesLoadingPdfJs = routes
    .map(({ route, firstLoadChunkPaths }) => ({ route, chunks: firstLoadChunkPaths.filter((p) => engine.has(p)) }))
    .filter((r) => r.chunks.length > 0);
  return { engineChunks, routesLoadingPdfJs };
}

/** Problems that make the check fail besides a size over its limit; empty when the build is within its budgets. */
export function budgetProblems(
  results: readonly RouteResult[],
  proof: PdfJsLazyProof,
  staleRoutes: readonly string[],
  waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS,
): string[] {
  const problems: string[] = [];
  for (const route of waivedPublicRoutes(waivers))
    problems.push(`${route}: a public route may not be waived from FE-9`);
  for (const r of results) {
    if (r.status === "over") {
      problems.push(`${r.route}: ${r.bytes} B gzip first-load JS is over its ${r.limitBytes} B limit`);
    } else if (r.status === "stale-waiver") {
      problems.push(
        `${r.route}: fits ${FIRST_LOAD_BUDGET_BYTES} B (${r.bytes} B), remove its entry from BUDGET_WAIVERS`,
      );
    }
  }
  for (const route of staleRoutes) problems.push(`${route}: BUDGET_WAIVERS names a route the build no longer has`);
  if (proof.engineChunks.length === 0) {
    problems.push(`pdf.js engine not found in any chunk: PDFJS_ENGINE_MARKERS are stale, the lazy proof is vacuous`);
  }
  for (const { route, chunks } of proof.routesLoadingPdfJs) {
    problems.push(`${route}: pdf.js is in its first load (${chunks.join(", ")}); load it lazily in the viewer only`);
  }
  return problems;
}

export interface BuildMeasurement {
  readonly routes: RouteStat[];
  readonly results: RouteResult[];
  readonly proof: PdfJsLazyProof;
  readonly staleRoutes: string[];
  readonly allChunks: string[];
}

/** Reads the build under `root` (the apps/web directory) and measures it. */
export function measureBuild(root = ".", waivers: Readonly<Record<string, number>> = BUDGET_WAIVERS): BuildMeasurement {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(`${root}/${STATS_PATH}`, "utf8"));
  } catch {
    throw new Error(`${STATS_PATH} not found: run \`pnpm --filter @kr/web build\` before perf:check`);
  }
  const routes = parseRouteStats(json);
  const allChunks = readdirSync(`${root}/${CHUNKS_DIR}`, { recursive: true, encoding: "utf8" })
    .map((file) => `${CHUNKS_DIR}/${file.replaceAll("\\", "/")}`)
    .filter((path) => path.endsWith(".js"));
  const cache = new Map<string, Buffer>();
  const bytesOf = (path: string): Buffer => {
    let buffer = cache.get(path);
    if (!buffer) {
      buffer = readFileSync(`${root}/${path}`);
      cache.set(path, buffer);
    }
    return buffer;
  };
  const results = evaluateRoutes(routes, (path) => gzipBytes(bytesOf(path)), waivers);
  const proof = proveLazyPdfJs(routes, allChunks, (path) => bytesOf(path).toString("utf8"));
  return { routes, results, proof, staleRoutes: unknownWaivers(routes, waivers), allChunks };
}
