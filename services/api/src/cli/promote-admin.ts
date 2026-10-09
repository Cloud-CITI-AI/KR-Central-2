/**
 * `node services/api/dist/cli/promote-admin.js <email>` — recovery for a tenant with no usable admin (PRODUCT_SPEC §3.3).
 * Run from a one-off shell of the API service, which holds DATABASE_URL. Prints no email, token or password.
 * Exit codes: 0 promoted (or already admin), 1 refused, 2 bad usage.
 */
import { createDb, type Db } from "@kr/db";
import { pathToFileURL } from "node:url";
import { loadApiConfig } from "../config.js";
import { promoteAdmin, type PromoteResult } from "../modules/auth/index.js";
import type { Clock } from "../platform/module.js";

const USAGE = "Usage: promote-admin <email>";
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const MESSAGES: Record<PromoteResult["status"], string> = {
  promoted: "Promoted the user to admin; their sessions were revoked.",
  already_admin: "That user is already an admin; nothing changed.",
  not_found: "No user has signed in with that email yet; ask them to sign in first.",
  guest: "Refused: that account is a guest (B2B) account; guests are never admins.",
  disabled: "Refused: that user is disabled.",
  ambiguous: "Refused: more than one active member has that email.",
};

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export async function main(argv: readonly string[], deps: { db: Db; clock: Clock } & CliIo): Promise<number> {
  const email = argv[0]?.trim().toLowerCase();
  if (argv.length !== 1 || email === undefined || !EMAIL.test(email)) {
    deps.err(USAGE);
    return 2;
  }
  const result = await promoteAdmin(deps.db, email, deps.clock);
  const ok = result.status === "promoted" || result.status === "already_admin";
  (ok ? deps.out : deps.err)(`${MESSAGES[result.status]}${"userId" in result ? ` (user ${result.userId})` : ""}`);
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadApiConfig();
  const db = createDb({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    maxConnections: 1,
    applicationName: "kr-api-promote-admin",
  });
  process.exitCode = await main(process.argv.slice(2), {
    db,
    clock: { now: () => new Date() },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).finally(() => db.destroy());
}
