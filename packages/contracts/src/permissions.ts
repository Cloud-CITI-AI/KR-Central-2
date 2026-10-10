/**
 * Roles and capabilities. The API is authoritative (deny by default, checked in every handler — BE-5);
 * the web app uses the same table only to show/hide controls.
 * See docs/spec/PRODUCT_SPEC.md §3 "Roles and permissions".
 */
import { z } from "zod";
import { GLOBAL_ROLES, GRANT_ROLES, hasCapability } from "./capabilities.js";

export { GLOBAL_ROLES, GRANT_ROLES, hasCapability };

/** Global role on the user record (the list is in capabilities.ts). */
export const GlobalRole = z.enum(GLOBAL_ROLES).meta({
  id: "GlobalRole",
  description:
    "admin: everything incl. user management; kr_admin: staff + fee proposals + audit; staff: all jobs; external: only jobs granted to them",
});
export type GlobalRole = z.infer<typeof GlobalRole>;

/** Role of an external user on one job (access grant; the list is in capabilities.ts). */
export const GrantRole = z.enum(GRANT_ROLES).meta({ id: "GrantRole" });
export type GrantRole = z.infer<typeof GrantRole>;

export const GLOBAL_CAPABILITIES = [
  "users.manage",
  "audit.read",
  "jobs.create",
  "jobs.read_all",
  "access.manage",
] as const;
export const GlobalCapability = z.enum(GLOBAL_CAPABILITIES).meta({ id: "GlobalCapability" });
export type GlobalCapability = z.infer<typeof GlobalCapability>;

export const JOB_CAPABILITIES = [
  "job.read",
  "job.edit",
  "job.delete",
  "checkpoint.status.edit",
  "checkpoint.responsibility.edit",
  "checkpoint.kr_note.edit",
  "checkpoint.decision.record",
  "checkpoint.paid.record",
  "fee_proposal.view",
  "files.upload.staff_slots",
  "files.upload.client_slots",
  "files.delete.any",
  "files.delete.own",
  "conditions.extract",
  "conditions.edit",
  "conditions.client_comment.edit",
  "conditions.evidence.upload",
  "conformance.read",
  "emails.add",
  "notes.create",
  "notes.delete.any",
  "package.download",
  "access.manage",
  "audit.read",
] as const;
export const JobCapability = z.enum(JOB_CAPABILITIES).meta({ id: "JobCapability" });
export type JobCapability = z.infer<typeof JobCapability>;

const STAFF_JOB: readonly JobCapability[] = [
  "job.read",
  "job.edit",
  "checkpoint.status.edit",
  "checkpoint.responsibility.edit",
  "checkpoint.kr_note.edit",
  "checkpoint.decision.record",
  "checkpoint.paid.record",
  "files.upload.staff_slots",
  "files.upload.client_slots",
  "files.delete.any",
  "files.delete.own",
  "conditions.extract",
  "conditions.edit",
  "conditions.client_comment.edit",
  "conditions.evidence.upload",
  "conformance.read",
  "emails.add",
  "notes.create",
  "notes.delete.any",
  "package.download",
  "access.manage",
];

const CLIENT_JOB: readonly JobCapability[] = [
  "job.read",
  "checkpoint.decision.record",
  "checkpoint.paid.record",
  "fee_proposal.view",
  "files.upload.client_slots",
  "files.delete.own",
  "conditions.client_comment.edit",
  "conditions.evidence.upload",
  "notes.create",
  "package.download",
];

const ARCHITECT_JOB: readonly JobCapability[] = [
  "job.read",
  "files.delete.own",
  "conditions.client_comment.edit",
  "conditions.evidence.upload",
  "notes.create",
  "package.download",
];

/** Global capabilities for a role. Disabled users have none (enforced by the session layer). */
export function globalCapabilitiesFor(role: GlobalRole): GlobalCapability[] {
  switch (role) {
    case "admin":
      return ["users.manage", "audit.read", "jobs.create", "jobs.read_all", "access.manage"];
    case "kr_admin":
      return ["audit.read", "jobs.create", "jobs.read_all", "access.manage"];
    case "staff":
      return ["jobs.create", "jobs.read_all", "access.manage"];
    case "external":
      return [];
  }
}

/**
 * Capabilities a user has on one job. `grantRole` is the user's active access grant on that job (externals only;
 * ignored for KR roles). Returns [] when the user has no access — callers must answer 404 (not 403) so job
 * existence is not disclosed to externals.
 */
export function jobCapabilitiesFor(role: GlobalRole, grantRole: GrantRole | null): JobCapability[] {
  switch (role) {
    case "admin":
      return [...STAFF_JOB, "fee_proposal.view", "job.delete", "audit.read"];
    case "kr_admin":
      return [...STAFF_JOB, "fee_proposal.view", "job.delete", "audit.read"];
    case "staff":
      return [...STAFF_JOB];
    case "external":
      if (grantRole === "client") return [...CLIENT_JOB];
      if (grantRole === "architect") return [...ARCHITECT_JOB];
      return [];
  }
}
