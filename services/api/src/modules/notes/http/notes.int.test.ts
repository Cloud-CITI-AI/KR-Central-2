import type { JobNote } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Note = z.output<typeof JobNote>;
interface Page {
  items: Note[];
  nextCursor: string | null;
}

describe("job notes (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const list = (who: SignedIn | undefined, query = "", job = jobId) =>
    apiRequest(t, { url: `/v1/jobs/${job}/notes${query}`, ...(who ? { as: who } : {}) });
  const post = (who: SignedIn | undefined, body: unknown, headers: Record<string, string> = {}, job = jobId) =>
    apiRequest(t, {
      method: "POST",
      url: `/v1/jobs/${job}/notes`,
      body,
      headers,
      ...(who ? { as: who } : {}),
    });
  const remove = (who: SignedIn, noteId: string, job = jobId) =>
    apiRequest(t, { method: "DELETE", url: `/v1/jobs/${job}/notes/${noteId}`, as: who });
  const audits = (action: string) =>
    t.db.selectFrom("audit_events").selectAll().where("action", "=", action).where("job_id", "=", jobId).execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff, client, architect, outsider] = [
      await as("admin"),
      await as("staff"),
      await as("external"),
      await as("external"),
      await as("external"),
    ];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("anyone with job access can add a note; the audience is stored as a label and defaults to all", async () => {
    for (const [who, audience] of [
      [client, "surveyor"],
      [architect, "client"],
      [staff, "all"],
    ] as const) {
      const res = await post(who, { body: "  A note  ", audience });
      expect(res.statusCode).toBe(201);
      expect(res.json<Note>()).toMatchObject({
        body: "A note",
        audience,
        author: { id: who.user.id, displayName: who.user.display_name },
        isOwn: true,
        canDelete: true,
        createdAt: t.deps.clock.now().toISOString(),
      });
    }
    expect((await post(admin, { body: "x" })).json<Note>().audience).toBe("all");
  });

  it("writes the audit event in the same transaction and never copies the text", async () => {
    const res = await post(staff, { body: "secret text", audience: "client" });
    const [event, ...rest] = (await audits("note.created")).filter((e) => e.entity_id === res.json<Note>().id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      actor_user_id: staff.user.id,
      entity_type: "note",
      request_id: res.headers["x-request-id"],
      changes: { audience: { from: null, to: "client" }, bodyLength: { from: null, to: 11 } },
    });
    expect(JSON.stringify(event?.changes)).not.toContain("secret");
  });

  it("rejects an empty or oversized body and unknown fields (400); no one without access can post", async () => {
    expect((await post(staff, { body: "   " })).statusCode).toBe(400);
    expect((await post(staff, { body: "x".repeat(5001) })).statusCode).toBe(400);
    expect((await post(staff, { body: "x".repeat(5000) })).statusCode).toBe(201);
    expect((await post(staff, { body: "x", audience: "everyone" })).statusCode).toBe(400);
    expect((await post(staff, { body: "x", extra: 1 })).statusCode).toBe(400);
    expect((await post(outsider, { body: "x" })).statusCode).toBe(404);
    expect((await post(undefined, { body: "x" })).statusCode).toBe(401);
  });

  it("an Idempotency-Key makes a repeated post create one note", async () => {
    const headers = { "idempotency-key": "note-key-0001" };
    const first = await post(client, { body: "once" }, headers);
    const second = await post(client, { body: "once" }, headers);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json<Note>().id).toBe(first.json<Note>().id);
  });

  it("every participant reads every note whatever its audience (label only)", async () => {
    const job = (await f.makeJob()).id;
    await f.makeGrant({ jobId: job, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job, userId: architect.user.id, role: "architect" });
    for (const audience of ["all", "surveyor", "client"] as const) {
      expect((await post(staff, { body: `for ${audience}`, audience }, {}, job)).statusCode).toBe(201);
    }
    for (const who of [admin, staff, client, architect]) {
      const res = await list(who, "", job);
      expect(res.statusCode).toBe(200);
      expect(
        res
          .json<Page>()
          .items.map((n) => n.audience)
          .sort(),
      ).toEqual(["all", "client", "surveyor"]);
    }
  });

  it("lists newest first in pages with a cursor and 404s for a job the caller cannot see", async () => {
    const job = (await f.makeJob()).id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      t.clock.advance(1000);
      ids.unshift((await post(staff, { body: `note ${i}` }, {}, job)).json<Note>().id);
    }
    const first = (await list(staff, "?limit=2", job)).json<Page>();
    expect(first.items.map((n) => n.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const second = (await list(staff, `?limit=2&cursor=${first.nextCursor}`, job)).json<Page>();
    expect(second.items.map((n) => n.id)).toEqual(ids.slice(2, 4));
    const third = (await list(staff, `?limit=2&cursor=${second.nextCursor}`, job)).json<Page>();
    expect(third).toEqual({ items: [expect.objectContaining({ id: ids[4] })], nextCursor: null });
    expect((await list(staff, "?cursor=garbage", job)).statusCode).toBe(400);
    expect((await list(outsider, "", job)).statusCode).toBe(404);
    expect((await list(undefined, "", job)).statusCode).toBe(401);
  });

  it("pages 50 at a time by default", async () => {
    const job = (await f.makeJob()).id;
    for (let i = 0; i < 51; i += 1) await f.makeNote({ jobId: job, authorId: staff.user.id });
    const page = (await list(staff, "", job)).json<Page>();
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    expect((await list(staff, `?cursor=${page.nextCursor}`, job)).json<Page>().items).toHaveLength(1);
  });

  it("marks isOwn and canDelete per viewer", async () => {
    const job = (await f.makeJob()).id;
    await f.makeGrant({ jobId: job, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job, userId: architect.user.id, role: "architect" });
    await f.makeNote({ jobId: job, authorId: client.user.id });
    const flags = async (who: SignedIn) =>
      (await list(who, "", job)).json<Page>().items.map((n) => [n.isOwn, n.canDelete]);
    expect(await flags(client)).toEqual([[true, true]]);
    expect(await flags(architect)).toEqual([[false, false]]);
    expect(await flags(staff)).toEqual([[false, true]]);
  });

  it("staff delete any note; others only their own (403 otherwise); the note is soft deleted and audited", async () => {
    const mine = (await post(client, { body: "mine" })).json<Note>();
    const theirs = (await post(staff, { body: "theirs" })).json<Note>();
    expect((await remove(architect, mine.id)).statusCode).toBe(403);
    expect((await remove(client, theirs.id)).statusCode).toBe(403);
    expect((await remove(client, mine.id)).statusCode).toBe(204);
    expect((await remove(admin, theirs.id)).statusCode).toBe(204);

    const row = await t.db.selectFrom("job_notes").selectAll().where("id", "=", mine.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ deleted_by: client.user.id, deleted_at: t.deps.clock.now() });
    const ids = (await list(staff, "?limit=100")).json<Page>().items.map((n) => n.id);
    expect(ids).not.toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const [event] = (await audits("note.deleted")).filter((e) => e.entity_id === mine.id);
    expect(event).toMatchObject({ actor_user_id: client.user.id, changes: { deleted: { from: false, to: true } } });
  });

  it("answers 404 for a deleted, unknown or foreign-job note and for callers without access", async () => {
    const note = (await post(staff, { body: "gone" })).json<Note>();
    expect((await remove(staff, note.id)).statusCode).toBe(204);
    expect((await remove(staff, note.id)).statusCode).toBe(404);
    expect((await remove(staff, "0f8fad5b-d9cb-469f-a165-70867728950e")).statusCode).toBe(404);
    const other = await f.makeJob();
    const kept = (await post(staff, { body: "kept" })).json<Note>();
    expect((await remove(staff, kept.id, other.id)).statusCode).toBe(404);
    expect((await remove(outsider, kept.id)).statusCode).toBe(404);
  });
});
