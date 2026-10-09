/**
 * Which jobs a caller may see, as a Kysely where-builder for list/count queries (dashboard, picker, facets, access
 * manager). It is the set-based twin of `resolveJobAccess` (platform/authz.ts): archived jobs are hidden from everyone;
 * `jobs.read_all` holders (staff, kr_admin, admin) see the rest; externals only jobs with an ACTIVE grant of theirs.
 * Usage: `db.selectFrom("jobs").where(visibleJobs(auth))`.
 */
import type { Database } from "@kr/db";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";
import type { AuthContext } from "../../platform/auth-context.js";

export function visibleJobs(auth: Pick<AuthContext, "user" | "globalCapabilities">) {
  return (eb: ExpressionBuilder<Database, "jobs">): Expression<SqlBool> => {
    const active = eb("jobs.deleted_at", "is", null);
    if (auth.globalCapabilities.includes("jobs.read_all")) return active;
    return eb.and([
      active,
      eb.exists(
        eb
          .selectFrom("access_grants")
          .select(sql.lit(1).as("granted"))
          .whereRef("access_grants.job_id", "=", "jobs.id")
          .where("access_grants.user_id", "=", auth.user.id)
          .where("access_grants.status", "=", "active"),
      ),
    ]);
  };
}
