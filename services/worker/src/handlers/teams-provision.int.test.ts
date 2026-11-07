/**
 * teams.provision against the local Graph fake (WP-25 acceptance 4 and 5): creates the root folder and every layout
 * folder, never 1.0, never touches 100/101 or anything else in the channel, is idempotent, queues existing clean files
 * (fee proposals as excluded), and reports a missing channel folder or grant as an error on the link.
 */
import { createMemoryStorage } from "@kr/storage/testing";
import type { Db } from "@kr/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext, insertFile } from "../../test/files.js";
import {
  ROOT,
  SITE,
  configureTeams,
  linkJob,
  linkRow,
  pushRows,
  startGraph,
  type GraphHarness,
} from "../../test/teams.js";
import { staticFlags } from "../flags.js";
import { layoutFolders } from "../domain/teams-layout.js";
import { teamsProvisionHandler } from "./teams-provision.js";

let db: Db;
let g: GraphHarness;
const storage = createMemoryStorage();
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
});
afterEach(async () => {
  await g.fake.stop();
});

interface Result {
  status: string;
  foldersCreated: number;
  filesQueued: number;
  errorCode: string | null;
}
interface Failure {
  code: string;
  retryable: boolean;
}
interface ProvisionOutcome {
  result?: Result;
  error?: Failure;
}

async function provision(jobId: string, flagOn = true): Promise<ProvisionOutcome> {
  const op = await enqueue(db, jobId, "teams.provision");
  const ctx = handlerContext(op);
  const handler = teamsProvisionHandler({
    db,
    flags: staticFlags({ "teams-file-sync": flagOn }),
    clock: g.clock,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000 },
    graph: g.graph,
  });
  const outcome: ProvisionOutcome = await handler.run(ctx).then(
    (result) => ({ result: result as Result }),
    (error: unknown) => ({ error: error as Failure }),
  );
  return outcome;
}

describe("teams.provision", () => {
  it("creates the root folder and every layout folder inside the channel, stores the ids and marks the link ready", async () => {
    const jobId = await insertJob(db);
    const { site, channelName } = await linkJob(db, g.fake, jobId);
    // the channel's template folders: never touched
    const channel = g.fake.itemAt(site.driveId, channelName);
    g.fake.seed(site.driveId, channel?.id ?? "", "100. Initial SURVEY");
    g.fake.seed(site.driveId, channel?.id ?? "", "101. Subdivison Process");
    const before = g.fake.requests.length;

    const { result } = await provision(jobId);
    expect(result?.status).toBe("ready");
    expect(result?.foldersCreated).toBe(layoutFolders().length + 1);
    const root = g.fake.itemAt(site.driveId, `${channelName}/${ROOT}`);
    expect(root?.isFolder).toBe(true);
    for (const path of layoutFolders()) {
      expect(g.fake.itemAt(site.driveId, `${channelName}/${ROOT}/${path}`)?.isFolder, path).toBe(true);
    }
    expect(g.fake.itemAt(site.driveId, `${channelName}/${ROOT}/01 Preliminaries/1.0 Fee proposal`)).toBeUndefined();
    const link = await linkRow(db, jobId);
    expect(link.status).toBe("ready");
    expect(link.drive_id).toBe(site.driveId);
    expect(link.root_folder_item_id).toBe(root?.id);
    expect(link.sharepoint_url).toContain(root?.id);
    expect(link.provisioned_at).not.toBeNull();
    const folders = await db.selectFrom("teams_folders").selectAll().where("job_id", "=", jobId).execute();
    expect(folders).toHaveLength(layoutFolders().length);
    // every Graph call stayed inside the channel's own folder tree: nothing under 100 or 101 was listed or written
    const touched = g.fake.requests
      .slice(before)
      .filter((r) => r.method !== "GET" || r.path.includes("/children"))
      .map((r) => r.path);
    for (const id of ["100. Initial SURVEY", "101. Subdivison Process"]) {
      const folderId = g.fake.itemAt(site.driveId, `${channelName}/${id}`)?.id ?? "none";
      expect(touched.some((p) => p.includes(folderId))).toBe(false);
    }
    const audit = await db.selectFrom("audit_events").select("action").where("job_id", "=", jobId).execute();
    expect(audit.map((a) => a.action)).toContain("teams.folders_provisioned");
  });

  it("creates nothing new on a second run and reuses folders someone made by hand", async () => {
    const jobId = await insertJob(db);
    const { site, channelName } = await linkJob(db, g.fake, jobId);
    const channel = g.fake.itemAt(site.driveId, channelName);
    const root = g.fake.seed(site.driveId, channel?.id ?? "", ROOT);
    g.fake.seed(site.driveId, root.id, "02 WAPC Approval");
    const first = await provision(jobId);
    expect(first.result?.foldersCreated).toBe(layoutFolders().length - 1);
    const itemsAfterFirst = g.fake.items(site.driveId).size;
    await db.deleteFrom("teams_folders").where("job_id", "=", jobId).execute(); // forget the ids: still idempotent
    const second = await provision(jobId);
    expect(second.result).toMatchObject({ status: "ready", foldersCreated: 0 });
    expect(g.fake.items(site.driveId).size).toBe(itemsAfterFirst);
  });

  it("queues every existing clean file, marks fee-proposal files excluded, and queues one teams.push", async () => {
    const jobId = await insertJob(db);
    await linkJob(db, g.fake, jobId);
    const clean = await insertFile(db, storage, jobId, { scanStatus: "clean", checkpointKey: "i2_0", slot: "survey" });
    const fee = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i1_0p",
      slot: "documents",
    });
    await insertFile(db, storage, jobId, { scanStatus: "pending", checkpointKey: "i2_0", slot: "survey" });
    await insertFile(db, storage, jobId, { scanStatus: "skipped", checkpointKey: "i2_0", slot: "survey" });
    const { result } = await provision(jobId);
    expect(result?.filesQueued).toBe(1);
    const rows = await pushRows(db, jobId);
    expect(rows.map((r) => [r.file_id, r.status])).toEqual(
      expect.arrayContaining([
        [clean.id, "pending"],
        [fee.id, "excluded"],
      ]),
    );
    expect(rows).toHaveLength(2);
    const pushes = await db
      .selectFrom("operations")
      .select("status")
      .where("type", "=", "teams.push")
      .where("job_id", "=", jobId)
      .execute();
    expect(pushes).toEqual([{ status: "queued" }]);
  });

  it("sets the link to error with channel_folder_missing when the channel has no folder, and permission_denied without a grant", async () => {
    const jobId = await insertJob(db);
    await linkJob(db, g.fake, jobId, { withFolder: false });
    expect((await provision(jobId)).result).toMatchObject({ status: "error", errorCode: "channel_folder_missing" });
    expect((await linkRow(db, jobId)).status).toBe("error");

    const other = await insertJob(db);
    const site = g.fake.site(SITE);
    if (site) site.writable = false;
    await linkJob(db, g.fake, other);
    expect((await provision(other)).result).toMatchObject({ status: "error", errorCode: "permission_denied" });
    expect((await linkRow(db, other)).error_code).toBe("permission_denied");
  });

  it("retries when Graph is down and completes as a no-op with copying off, the flag off or no link", async () => {
    const jobId = await insertJob(db);
    await linkJob(db, g.fake, jobId);
    g.fake.failNext(20, { status: 503 });
    const down = await provision(jobId);
    expect(down.error).toMatchObject({ code: "graph_unavailable", retryable: true });
    expect((await linkRow(db, jobId)).status).toBe("provisioning");

    expect((await provision(jobId, false)).result?.status).toBe("skipped");
    await configureTeams(db, { syncEnabled: false });
    expect((await provision(jobId)).result?.status).toBe("skipped");
    await configureTeams(db);
    expect((await provision(await insertJob(db))).result?.status).toBe("skipped");
  });
});
