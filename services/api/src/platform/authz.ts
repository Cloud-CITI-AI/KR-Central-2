/**
 * Authorisation helpers (BE-5, deny by default). Every session handler must call one of these; defineRoute fails the
 * request when none ran. Job-scoped helpers answer 404 (never 403) for jobs the caller cannot see, so a job's existence
 * is not disclosed (PRODUCT_SPEC §2.1).
 */
import { jobCapabilitiesFor, type GlobalCapability, type GrantRole, type JobCapability } from "@kr/contracts";
import type { Db, JobRow } from "@kr/db";
import type { ApiConfig } from "../config.js";
import { markAuthzChecked, type AuthContext } from "./auth-context.js";
import { ForbiddenError, NotFoundError } from "./errors.js";

/** For operations open to any signed-in user acting on their own session (getMe, logout). */
export function requireSignedIn(auth: AuthContext): void {
  markAuthzChecked(auth);
}

export function requireCapability(auth: AuthContext, capability: GlobalCapability): void {
  markAuthzChecked(auth);
  if (!auth.globalCapabilities.includes(capability)) throw new ForbiddenError();
}

export interface JobAccess {
  readonly job: JobRow;
  /** The caller's ACTIVE grant on this job (externals only). */
  readonly grantRole: GrantRole | null;
  readonly capabilities: readonly JobCapability[];
}

export function requireJobCapability(access: Pick<JobAccess, "capabilities">, capability: JobCapability): void {
  if (!access.capabilities.includes(capability)) throw new ForbiddenError();
}

/**
 * Load a job the caller may see: staff see every non-archived job, externals only through an active grant on a
 * non-archived job. Unknown, archived and invisible jobs are all the same 404. `required` capabilities that are missing
 * are 403. Visibility is evaluated on every request, so revoking a grant takes effect on the next call.
 */
export async function resolveJobAccess(
  db: Db,
  auth: AuthContext,
  jobId: string,
  required: JobCapability | readonly JobCapability[] = [],
): Promise<JobAccess> {
  markAuthzChecked(auth);
  const job = await db
    .selectFrom("jobs")
    .selectAll()
    .where("id", "=", jobId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!job) throw new NotFoundError();
  let grantRole: GrantRole | null = null;
  if (auth.user.role === "external") {
    const grant = await db
      .selectFrom("access_grants")
      .select("role")
      .where("job_id", "=", jobId)
      .where("user_id", "=", auth.user.id)
      .where("status", "=", "active")
      .executeTakeFirst();
    grantRole = grant?.role ?? null;
  }
  const capabilities = jobCapabilitiesFor(auth.user.role, grantRole);
  if (capabilities.length === 0) throw new NotFoundError();
  const access: JobAccess = { job, grantRole, capabilities };
  const needed: readonly JobCapability[] = typeof required === "string" ? [required] : required;
  for (const capability of needed) requireJobCapability(access, capability);
  return access;
}

/**
 * Admin-only endpoints (user management, audit) need MFA evidence when REQUIRE_MFA_FOR_ADMIN is on (PRODUCT_SPEC §3.1):
 * `amr` contains "mfa" (ADMIN_MFA_EVIDENCE=amr) or `acrs` contains the Conditional Access context
 * ENTRA_ADMIN_AUTH_CONTEXT_ID (acrs). Applies to admin and kr_admin sessions.
 */
export function assertMfaForAdmin(
  auth: AuthContext,
  config: Pick<ApiConfig, "REQUIRE_MFA_FOR_ADMIN" | "ADMIN_MFA_EVIDENCE" | "ENTRA_ADMIN_AUTH_CONTEXT_ID">,
): void {
  if (!config.REQUIRE_MFA_FOR_ADMIN || (auth.user.role !== "admin" && auth.user.role !== "kr_admin")) return;
  const context = config.ENTRA_ADMIN_AUTH_CONTEXT_ID;
  const proven =
    config.ADMIN_MFA_EVIDENCE === "amr"
      ? auth.session.amr.includes("mfa")
      : context !== undefined && auth.session.acrs.includes(context);
  if (!proven) throw new ForbiddenError({ detail: "Multi-factor sign-in required" });
}
