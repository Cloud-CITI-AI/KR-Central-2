/** The sweep tasks the worker runs every hour. */
import type { Db } from "@kr/db";
import { deleteExpiredRows } from "../data/sweeps.js";
import type { SweepTask } from "./runner.js";

export function buildSweepTasks(deps: { readonly db: Db }): SweepTask[] {
  return [{ name: "expired_rows", run: (c) => deleteExpiredRows(deps.db, c) }];
}
