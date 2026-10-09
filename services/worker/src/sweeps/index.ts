/** The sweep tasks the worker runs every hour. */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { deleteExpiredRows, purgeDeletedFiles } from "../data/sweeps.js";
import type { SweepTask } from "./runner.js";

export function buildSweepTasks(deps: {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly log: Logger;
}): SweepTask[] {
  return [
    { name: "purge_files", run: (c) => purgeDeletedFiles(deps.db, deps.storage, c, deps.log) },
    { name: "expired_rows", run: (c) => deleteExpiredRows(deps.db, c) },
  ];
}
