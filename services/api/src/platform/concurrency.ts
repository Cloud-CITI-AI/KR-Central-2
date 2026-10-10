/** Optimistic concurrency (PRODUCT_SPEC §14, DATA_MODEL §6): `If-Match: "<version>"`, missing → 428, stale → 412. */
import type { IncomingHttpHeaders } from "node:http";
import type { Database } from "@kr/db";
import type { FastifyReply } from "fastify";
import type { Transaction } from "kysely";
import { BadRequestError, PreconditionFailedError, PreconditionRequiredError } from "./errors.js";

/** Parse the If-Match header into the version the client last saw. */
export function parseIfMatch(headers: IncomingHttpHeaders): number {
  const raw = headers["if-match"];
  if (raw === undefined)
    throw new PreconditionRequiredError({ detail: "Send the current version in the If-Match header." });
  const m = typeof raw === "string" ? /^"(\d{1,9})"$/.exec(raw) : null;
  if (!m?.[1]) throw new BadRequestError({ detail: 'If-Match must be a quoted version number, e.g. "3".' });
  return Number(m[1]);
}

export function formatEtag(version: number): string {
  return `"${version}"`;
}

export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header("etag", formatEtag(version));
}

/** For repositories that load before writing: stale version → 412 (the SQL `WHERE version = $n` guard is the real lock). */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
  }
}

/** Which audit events describe the writes of one versioned row. */
export interface AuditScope {
  readonly jobId: string;
  /** Narrow to one entity (a checkpoint, a condition) … */
  readonly entity?: { readonly type: string; readonly id: string };
  /** … or to the actions that bump the row (the job, which several writers change). */
  readonly actions?: readonly string[];
}

/** Writes further behind than this are not reconstructed; the client reloads. */
const MAX_VERSIONS_BEHIND = 25;
/** One write audits at most one event per field it changes (a checkpoint edit: 3); bounds the audit read. */
const MAX_EVENTS_PER_WRITE = 5;

/**
 * The audit field names changed by the last `behind` writes of a row, or null when they cannot be told apart. Every
 * version bump of a row is one transaction that audits its changed fields ({from, to} keyed by field), and one request
 * writes one version, so the newest `behind` request ids (a null one, from the worker, counts for itself) are the writes
 * since the client's version. null (fail closed) when the trail holds fewer writes than the version moved.
 */
async function fieldsChangedSince(
  trx: Transaction<Database>,
  scope: AuditScope,
  behind: number,
): Promise<ReadonlySet<string> | null> {
  if (behind > MAX_VERSIONS_BEHIND) return null;
  let query = trx.selectFrom("audit_events").select(["id", "request_id", "changes"]).where("job_id", "=", scope.jobId);
  if (scope.entity) {
    query = query.where("entity_type", "=", scope.entity.type).where("entity_id", "=", scope.entity.id);
  }
  if (scope.actions) query = query.where("action", "in", scope.actions);
  const events = await query
    .orderBy("id", "desc")
    .limit(behind * MAX_EVENTS_PER_WRITE + 1)
    .execute();
  const writes = new Set<string>();
  const changed = new Set<string>();
  for (const event of events) {
    const write = event.request_id ?? `event:${event.id}`;
    if (!writes.has(write)) {
      if (writes.size === behind) break;
      writes.add(write);
    }
    for (const field of Object.keys(event.changes ?? {})) changed.add(field);
  }
  return writes.size === behind ? changed : null;
}

/**
 * If-Match for a write that changes `fields` (the audit field names its plan changes): the current version, or an older
 * one when none of those fields was changed by the writes since (PRODUCT_SPEC §14/§15: a 412 is for two people editing the
 * same thing, not for a comment typed beside someone else's tick). A client ahead of the row, a write that cannot be
 * reconstructed, or a changed field in common is a 412. A request that changes nothing never conflicts.
 */
export async function assertNoFieldConflict(
  trx: Transaction<Database>,
  scope: AuditScope,
  versions: { readonly current: number; readonly expected: number },
  fields: readonly string[],
): Promise<void> {
  const { current, expected } = versions;
  if (current === expected) return;
  if (expected > current) assertVersion(current, expected);
  if (fields.length === 0) return;
  const changed = await fieldsChangedSince(trx, scope, current - expected);
  if (!changed || fields.some((field) => changed.has(field))) assertVersion(current, expected);
}
