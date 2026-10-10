// Prints every route's first-load JS against its budget and exits 1 on a breach. Run from apps/web after `pnpm build`:
//   node scripts/perf/check-route-budgets.ts            budgets as enforced by `pnpm perf:check` (with waivers)
//   node scripts/perf/check-route-budgets.ts --strict   the bare FE-9 170 KB budget: lists every route over it
import { FIRST_LOAD_BUDGET_BYTES, budgetProblems, measureBuild } from "./route-budgets.ts";

const strict = process.argv.includes("--strict");
const { results, proof, staleRoutes } = measureBuild(".", strict ? {} : undefined);

const kb = (bytes: number) => (bytes / 1000).toFixed(2).padStart(7);
console.log(
  `first-load JS per route, gzip (FE-9 budget ${FIRST_LOAD_BUDGET_BYTES / 1000} KB${strict ? ", strict" : ""})`,
);
for (const r of [...results].sort((a, b) => b.bytes - a.bytes)) {
  console.log(`${kb(r.bytes)} kB  limit ${kb(r.limitBytes)} kB  ${r.status.padEnd(12)} ${r.route}`);
}
console.log(
  `pdf.js engine: ${proof.engineChunks.length} lazy chunk(s), in the first load of ${proof.routesLoadingPdfJs.length} route(s)`,
);

const problems = budgetProblems(results, proof, staleRoutes);
for (const problem of problems) console.error(`FAIL ${problem}`);
process.exit(problems.length > 0 ? 1 : 0);
