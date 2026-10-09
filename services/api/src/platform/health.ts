/** Liveness (no dependencies) and readiness (database + object storage, 2 s timeouts) — contract getLiveness/getReadiness. */
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { defineRoute } from "./routes.js";
import type { ModuleDeps } from "./module.js";

export const READINESS_TIMEOUT_MS = 2000;

type Check = "ok" | "fail";

/** Run `probe`, resolving "fail" on rejection or after `timeoutMs` (the probe is abandoned, not cancelled). */
export async function runCheck(probe: () => Promise<unknown>, timeoutMs: number): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Check>((resolve) => {
    timer = setTimeout(() => {
      resolve("fail");
    }, timeoutMs);
  });
  try {
    return await Promise.race([probe().then((): Check => "ok"), timeout]);
  } catch {
    return "fail";
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, deps: Pick<ModuleDeps, "db" | "storage">): void {
  defineRoute(app, "getLiveness", () => Promise.resolve({ status: "ok" as const, checks: {} }));

  defineRoute(app, "getReadiness", async ({ reply }) => {
    const [database, storage] = await Promise.all([
      runCheck(() => sql`select 1`.execute(deps.db), READINESS_TIMEOUT_MS),
      runCheck(() => deps.storage.ping(), READINESS_TIMEOUT_MS),
    ]);
    const ok = database === "ok" && storage === "ok";
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks: { database, storage } });
  });
}
