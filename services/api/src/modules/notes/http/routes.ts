/** listNotes, createNote and deleteNote (PRODUCT_SPEC §5.7). The audience is a label only: every party reads every note. */
import type { FastifyInstance } from "fastify";
import { toJobNote } from "../../_shared/index.js";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { resolveJobAccess } from "../../../platform/authz.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { insertNote, listNoteRows, lockLiveNote, softDeleteNote } from "../data/notes.js";
import { decodeNoteCursor, encodeNoteCursor } from "../domain/cursor.js";

export function registerNoteRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "listNotes", async ({ auth, params, query }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "job.read");
    const after = query.cursor === undefined ? null : decodeNoteCursor(query.cursor);
    if (query.cursor !== undefined && after === null) throw new BadRequestError({ detail: "The cursor is not valid." });
    const rows = await listNoteRows(deps.db, params.jobId, after, query.limit);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const canDeleteAny = access.capabilities.includes("notes.delete.any");
    return {
      items: page.map(({ row, authorName }) =>
        toJobNote(row, {
          viewerId: auth.user.id,
          canDeleteAny,
          author:
            row.author_id !== null && authorName !== null ? { id: row.author_id, display_name: authorName } : null,
        }),
      ),
      nextCursor: rows.length > query.limit && last ? encodeNoteCursor(last.row.id) : null,
    };
  });

  defineRoute(app, "createNote", async ({ auth, request, reply, params, body }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "notes.create");
    const result = await withIdempotency(
      deps.db,
      { request, userId: auth.user.id, operationId: "createNote", body, clock: deps.clock },
      async (trx) => {
        const row = await insertNote(
          trx,
          { jobId: params.jobId, authorId: auth.user.id, body: body.body, audience: body.audience },
          deps.clock.now(),
        );
        // The note text is free text and is never copied into the audit trail; only its length is.
        await audit(trx, auditContext(request), {
          action: "note.created",
          entityType: "note",
          entityId: row.id,
          jobId: params.jobId,
          changes: { audience: { from: null, to: row.audience }, bodyLength: { from: null, to: row.body.length } },
        });
        const note = toJobNote(row, {
          viewerId: auth.user.id,
          canDeleteAny: access.capabilities.includes("notes.delete.any"),
          author: { id: auth.user.id, display_name: auth.user.displayName },
        });
        return { status: 201, body: note };
      },
    );
    return sendIdempotent(reply, result);
  });

  defineRoute(app, "deleteNote", async ({ auth, request, reply, params }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "job.read");
    await withTransaction(deps.db, async (trx) => {
      const note = await lockLiveNote(trx, params.jobId, params.noteId);
      if (!note) throw new NotFoundError();
      // Staff may delete any note; everyone else only their own (PRODUCT_SPEC §5.7).
      const own = note.author_id !== null && note.author_id === auth.user.id;
      if (!own && !access.capabilities.includes("notes.delete.any")) throw new ForbiddenError();
      await softDeleteNote(trx, note.id, auth.user.id, deps.clock.now());
      await audit(trx, auditContext(request), {
        action: "note.deleted",
        entityType: "note",
        entityId: note.id,
        jobId: params.jobId,
        changes: { deleted: { from: false, to: true } },
      });
    });
    return reply.code(204).send();
  });
}
