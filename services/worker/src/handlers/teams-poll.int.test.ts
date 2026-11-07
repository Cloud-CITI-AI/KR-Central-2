/**
 * teams.poll against the local Graph fake (WP-26 acceptance): a file added in a checkpoint folder becomes a scanned
 * file from Teams, a file at the root is unfiled and can be filed or dismissed, the app's own copies are never
 * re-imported, an edit in Teams replaces the app's file, a delete in Teams marks it removed, an expired delta token
 * resyncs without duplicates, and the switches make it a no-op. Needs the test database (migrations 0005–0007).
 */
import { createMemoryStorage } from "@kr/storage/testing";
import { CHECKPOINTS } from "@kr/workflow";
import type { Db } from "@kr/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext, insertFile } from "../../test/files.js";
import { ROOT, configureTeams, linkJob, linkRow, pushRows, startGraph, type GraphHarness } from "../../test/teams.js";
import { staticFlags } from "../flags.js";
import { teamsPollHandler } from "./teams-poll.js";
import { teamsProvisionHandler } from "./teams-provision.js";
import { teamsPushHandler } from "./teams-push.js";

let db: Db;
let g: GraphHarness;
const storage = createMemoryStorage();
const flags = staticFlags({ "teams-file-sync": true });
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
  g = await startGraph();
  await configureTeams(db);
  await db.updateTable("teams_settings").set({ inbound_sync_enabled: true }).where("singleton", "=", true).execute();
});
afterEach(async () => {
  await g.fake.stop();
});

interface Result {
  imported: number;
  unfiled: number;
  replaced: number;
  removed: number;
  failed: number;
  skipped: boolean;
}

async function provisioned(jobId: string) {
  // a real job carries all 46 checkpoint rows from creation; the worker's test helper inserts the bare job
  await db
    .insertInto("checkpoint_states")
    .values(CHECKPOINTS.map((c) => ({ job_id: jobId, checkpoint_key: c.key })))
    .onConflict((oc) => oc.doNothing())
    .execute();
  const { site, channelName } = await linkJob(db, g.fake, jobId);
  const op = await enqueue(db, jobId, "teams.provision");
  await teamsProvisionHandler({
    db,
    flags,
    clock: g.clock,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000 },
    graph: g.graph,
  }).run(handlerContext(op));
  const link = await linkRow(db, jobId);
  const folderId = (path: string) => g.fake.itemAt(site.driveId, `${channelName}/${ROOT}/${path}`)?.id ?? "";
  return { site, channelName, link, folderId, rootId: link.root_folder_item_id ?? "" };
}

async function poll(jobId: string, payload: Record<string, unknown> = {}): Promise<Result> {
  const op = await enqueue(db, jobId, "teams.poll", payload);
  const handler = teamsPollHandler({
    db,
    storage,
    flags,
    clock: g.clock,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000, UPLOAD_MAX_BYTES: 1024 * 1024 },
    graph: g.graph,
  });
  return (await handler.run(handlerContext(op))) as Result;
}

async function push(jobId: string) {
  const op = await enqueue(db, jobId, "teams.push");
  return teamsPushHandler({
    db,
    storage,
    flags,
    clock: g.clock,
    metrics: { recordTeamsPush: () => undefined },
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000, TEAMS_CLIENT_ID: g.fake.appId },
    graph: g.graph,
  }).run(handlerContext(op));
}

const filesOf = (jobId: string) =>
  db.selectFrom("files").selectAll().where("job_id", "=", jobId).orderBy("uploaded_at").execute();
const inboundOf = (jobId: string) =>
  db.selectFrom("teams_inbound_items").selectAll().where("job_id", "=", jobId).orderBy("seen_at").execute();

describe("teams.poll", () => {
  it("brings a file added in a checkpoint folder into that checkpoint with a scan queued, and unfiles one at the root", async () => {
    const jobId = await insertJob(db);
    const { site, folderId, rootId } = await provisioned(jobId);
    g.fake.seed(site.driveId, folderId("01 Preliminaries/2.0 Site Feature Survey"), "survey.pdf", PDF, "person");
    g.fake.seed(site.driveId, rootId, "loose.pdf", PDF, "person");
    const first = await poll(jobId);
    expect(first).toMatchObject({ imported: 1, unfiled: 1, replaced: 0, removed: 0, failed: 0, skipped: false });
    const files = await filesOf(jobId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      checkpoint_key: "i2_0",
      slot: "survey",
      kind: "pdf",
      source: "teams",
      uploaded_by: null,
      scan_status: "pending",
    });
    expect(await storage.exists(files[0]?.storage_key ?? "")).toBe(true);
    const scans = await db
      .selectFrom("operations")
      .select("type")
      .where("job_id", "=", jobId)
      .where("type", "=", "file.scan")
      .execute();
    expect(scans).toHaveLength(1);
    const rows = await pushRows(db, jobId);
    expect(rows.find((r) => r.file_id === files[0]?.id)).toMatchObject({ status: "pushed" });
    const inbound = await inboundOf(jobId);
    expect(inbound.map((i) => [i.name, i.status, i.modified_by_name])).toEqual([
      ["survey.pdf", "imported", "Sam Surveyor"],
      ["loose.pdf", "unfiled", "Sam Surveyor"],
    ]);
    expect((await linkRow(db, jobId)).delta_token).not.toBeNull();

    // nothing changed: a second poll does nothing, and a push does not send the imported file back
    expect(await poll(jobId)).toMatchObject({ imported: 0, unfiled: 0 });
    const uploads = g.fake.requests.filter((r) => r.method === "PUT").length;
    await push(jobId);
    expect(g.fake.requests.filter((r) => r.method === "PUT")).toHaveLength(uploads);
  });

  it("files an unfiled item on request and refuses a kind the slot does not take", async () => {
    const jobId = await insertJob(db);
    const { site, rootId } = await provisioned(jobId);
    const loose = g.fake.seed(site.driveId, rootId, "letter.pdf", PDF, "person");
    const script = g.fake.seed(site.driveId, rootId, "run.sh", Buffer.from("#!/bin/sh\necho hi\n"), "person");
    await poll(jobId);
    expect((await inboundOf(jobId)).map((i) => [i.name, i.status, i.error_code])).toEqual([
      ["letter.pdf", "unfiled", null],
      ["run.sh", "unfiled", null],
    ]);
    expect(await poll(jobId, { import: { itemId: loose.id, checkpointKey: "i2_0", slot: "survey" } })).toMatchObject({
      imported: 1,
    });
    expect((await filesOf(jobId))[0]).toMatchObject({ checkpoint_key: "i2_0", original_name: "letter.pdf" });
    expect(await poll(jobId, { import: { itemId: script.id, checkpointKey: "i2_0", slot: "survey" } })).toMatchObject({
      failed: 1,
    });
    expect((await inboundOf(jobId)).find((i) => i.drive_item_id === script.id)).toMatchObject({
      status: "unfiled",
      error_code: "kind_not_accepted",
    });
  });

  it("replaces the app's file when its copy is edited in Teams and marks it removed when deleted there", async () => {
    const jobId = await insertJob(db);
    const { site } = await provisioned(jobId);
    const ours = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "plan.pdf",
      bytes: PDF,
    });
    await db.insertInto("teams_file_pushes").values({ file_id: ours.id, job_id: jobId, status: "pending" }).execute();
    await push(jobId);
    const pushed = (await pushRows(db, jobId))[0];
    expect(pushed?.status).toBe("pushed");
    expect(await poll(jobId)).toMatchObject({ imported: 0, replaced: 0 });

    const edited = Buffer.concat([PDF, Buffer.from("% edited\n")]);
    g.fake.edit(site.driveId, pushed?.drive_item_id ?? "", edited, "Pat Planner");
    expect(await poll(jobId)).toMatchObject({ replaced: 1 });
    const files = await filesOf(jobId);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ id: ours.id, deleted_reason: "teams_replaced" });
    expect(files[0]?.deleted_at).not.toBeNull();
    expect(files[1]).toMatchObject({
      checkpoint_key: "i2_0",
      slot: "survey",
      source: "teams",
      size_bytes: String(edited.byteLength),
    });
    const rows = await pushRows(db, jobId);
    expect(rows.map((r) => [r.file_id, r.status])).toEqual([[files[1]?.id, "pushed"]]);

    g.fake.remove(site.driveId, pushed?.drive_item_id ?? "");
    expect(await poll(jobId)).toMatchObject({ removed: 1 });
    expect((await filesOf(jobId))[1]?.teams_removed_at).not.toBeNull();
    expect((await pushRows(db, jobId))[0]?.status).toBe("deleted");
    const audit = await db.selectFrom("audit_events").select("action").where("job_id", "=", jobId).execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["file.teams_imported", "file.teams_replaced", "file.teams_removed"]),
    );
  });

  it("resyncs after an expired delta token without importing twice", async () => {
    const jobId = await insertJob(db);
    const { site, folderId } = await provisioned(jobId);
    g.fake.seed(site.driveId, folderId("01 Preliminaries/2.0 Site Feature Survey"), "one.pdf", PDF, "person");
    expect(await poll(jobId)).toMatchObject({ imported: 1 });
    g.fake.expireDeltaOnce();
    g.fake.seed(site.driveId, folderId("01 Preliminaries/2.0 Site Feature Survey"), "two.pdf", PDF, "person");
    expect(await poll(jobId)).toMatchObject({ imported: 1 });
    expect(await filesOf(jobId)).toHaveLength(2);
  });

  it("is a no-op with inbound sync off or the link not ready, and still files on request", async () => {
    const jobId = await insertJob(db);
    const { site, rootId } = await provisioned(jobId);
    const loose = g.fake.seed(site.driveId, rootId, "x.pdf", PDF, "person");
    await db.updateTable("teams_settings").set({ inbound_sync_enabled: false }).where("singleton", "=", true).execute();
    expect(await poll(jobId)).toMatchObject({ skipped: true });
    expect(await poll(jobId, { import: { itemId: loose.id, checkpointKey: "i2_0", slot: "survey" } })).toMatchObject({
      imported: 1,
    });
    await db.updateTable("teams_settings").set({ inbound_sync_enabled: true }).where("singleton", "=", true).execute();
    await db.updateTable("job_teams_links").set({ status: "error" }).where("job_id", "=", jobId).execute();
    expect(await poll(jobId)).toMatchObject({ skipped: true });
  });

  it("removes the copy in Teams after an app delete only while the eTag matches", async () => {
    const jobId = await insertJob(db);
    const { site } = await provisioned(jobId);
    const ours = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "del.pdf",
      bytes: PDF,
    });
    await db.insertInto("teams_file_pushes").values({ file_id: ours.id, job_id: jobId, status: "pending" }).execute();
    await push(jobId);
    const row = (await pushRows(db, jobId))[0];
    g.fake.edit(site.driveId, row?.drive_item_id ?? "", Buffer.from("changed"));
    await db.updateTable("teams_file_pushes").set({ status: "deleting" }).where("file_id", "=", ours.id).execute();
    expect(await push(jobId)).toMatchObject({ deleted: 0 });
    expect((await pushRows(db, jobId))[0]).toMatchObject({ status: "pushed", error_code: "etag_changed" });
    expect(g.fake.items(site.driveId).has(row?.drive_item_id ?? "")).toBe(true);

    const fresh = g.fake.items(site.driveId).get(row?.drive_item_id ?? "");
    await db
      .updateTable("teams_file_pushes")
      .set({ status: "deleting", etag: fresh?.eTag ?? null })
      .where("file_id", "=", ours.id)
      .execute();
    expect(await push(jobId)).toMatchObject({ deleted: 1 });
    expect(g.fake.items(site.driveId).has(row?.drive_item_id ?? "")).toBe(false);
    expect((await pushRows(db, jobId))[0]?.status).toBe("deleted");
  });
});
