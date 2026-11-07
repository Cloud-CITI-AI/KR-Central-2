/**
 * teams.push against the local Graph fake (WP-25 acceptance 5, 6 and 7): every clean file is copied exactly once into
 * its checkpoint or evidence folder, duplicate names get " (2)", a crash between upload and record does not make a
 * second copy, nothing is overwritten, large files go in chunks with no bearer header on the session URL, throttling
 * requeues the operation, and the file-scan hook queues a push for a clean file of a linked job.
 */
import { createMemoryStorage } from "@kr/storage/testing";
import type { Db } from "@kr/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeClamd, type FakeClamd } from "../../test/fake-clamd.js";
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
import { createClamdClient } from "../clients/clamd.js";
import { UPLOAD_CHUNK_BYTES } from "../clients/graph-drive.js";
import { staticFlags } from "../flags.js";
import { fileScanHandler } from "./file-scan.js";
import { teamsProvisionHandler } from "./teams-provision.js";
import { PUSH_MAX_ATTEMPTS, teamsPushHandler } from "./teams-push.js";

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

const flags = staticFlags({ "teams-file-sync": true });
const results: string[] = [];
const metrics = {
  recordTeamsPush: (r: string) => {
    results.push(r);
  },
};

async function provisioned(jobId: string) {
  await linkJob(db, g.fake, jobId);
  const op = await enqueue(db, jobId, "teams.provision");
  await teamsProvisionHandler({
    db,
    flags,
    clock: g.clock,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000 },
    graph: g.graph,
  }).run(handlerContext(op));
  return linkRow(db, jobId);
}

interface Result {
  pushed: number;
  failed: number;
  skipped: number;
}
interface Failure {
  code: string;
  retryable: boolean;
}
interface PushOutcome {
  result?: Result;
  error?: Failure;
}

async function push(jobId: string): Promise<PushOutcome> {
  const op = await enqueue(db, jobId, "teams.push");
  const handler = teamsPushHandler({
    db,
    storage,
    flags,
    clock: g.clock,
    metrics,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000, TEAMS_CLIENT_ID: g.fake.appId },
    graph: g.graph,
  });
  const outcome: PushOutcome = await handler.run(handlerContext(op)).then(
    (result) => ({ result: result as Result }),
    (error: unknown) => ({ error: error as Failure }),
  );
  return outcome;
}

async function queued(
  jobId: string,
  file: { id: string },
  status: "pending" | "failed" = "pending",
  extra: Record<string, unknown> = {},
) {
  await db
    .insertInto("teams_file_pushes")
    .values({ file_id: file.id, job_id: jobId, status, ...extra })
    .execute();
}

describe("teams.push", () => {
  it("copies clean files into their checkpoint and evidence folders exactly once, with ' (2)' on a duplicate name", async () => {
    const jobId = await insertJob(db);
    const link = await provisioned(jobId);
    const condition = await db
      .insertInto("conditions")
      .values({ job_id: jobId, condition_number: 3, text: "Power", agency: "Western Power", responsibility: "kr" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const a = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "plan.pdf",
      bytes: "A",
    });
    const b = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "plan.pdf",
      bytes: "BB",
    });
    const e = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      conditionId: condition.id,
      name: "photo",
      kind: "image",
      bytes: "PNG",
    });
    for (const f of [a, b, e]) await queued(jobId, f);

    const first = await push(jobId);
    expect(first.result).toEqual({ pushed: 3, failed: 0, skipped: 0, deleted: 0 });
    const rows = await pushRows(db, jobId);
    expect(rows.map((r) => [r.status, r.remote_path])).toEqual([
      ["pushed", "01 Preliminaries/2.0 Site Feature Survey/plan.pdf"],
      ["pushed", "01 Preliminaries/2.0 Site Feature Survey/plan (2).pdf"],
      ["pushed", "03 Western Power/WAPC conditions/Condition 3 evidence/photo.png"],
    ]);
    for (const r of rows) expect(r.drive_item_id).not.toBeNull();
    const drive = link.drive_id ?? "";
    const channel = (await linkRow(db, jobId)).channel_name;
    expect(
      g.fake.itemAt(drive, `${channel}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey/plan (2).pdf`)?.content,
    ).toEqual(Buffer.from("BB"));
    expect(
      g.fake.itemAt(drive, `${channel}/${ROOT}/03 Western Power/WAPC conditions/Condition 3 evidence/photo.png`),
    ).toBeDefined();
    expect((await linkRow(db, jobId)).last_push_at).not.toBeNull();

    // a second run has nothing due and makes no second copy
    const uploads = g.fake.requests.filter((r) => r.method === "PUT").length;
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 0, skipped: 0, deleted: 0 });
    expect(g.fake.requests.filter((r) => r.method === "PUT")).toHaveLength(uploads);
    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("job_id", "=", jobId)
      .where("action", "=", "file.teams_pushed")
      .execute();
    expect(audit).toHaveLength(3);
  });

  it("never copies infected, pending, skipped, removed or fee-proposal files", async () => {
    const jobId = await insertJob(db);
    await provisioned(jobId);
    const bad = [
      await insertFile(db, storage, jobId, { scanStatus: "infected", checkpointKey: "i2_0", slot: "survey" }),
      await insertFile(db, storage, jobId, { scanStatus: "pending", checkpointKey: "i2_0", slot: "survey" }),
      await insertFile(db, storage, jobId, { scanStatus: "skipped", checkpointKey: "i2_0", slot: "survey" }),
      await insertFile(db, storage, jobId, { scanStatus: "clean", checkpointKey: "i1_0p", slot: "documents" }),
    ];
    const removed = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
    });
    await db
      .updateTable("files")
      .set({ deleted_at: new Date("2026-11-06T00:00:00Z") })
      .where("id", "=", removed.id)
      .execute();
    for (const f of [...bad, removed]) await queued(jobId, f);
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 0, skipped: 5, deleted: 0 });
    expect(g.fake.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
    const rows = await pushRows(db, jobId);
    expect(rows.every((r) => r.status === "excluded")).toBe(true);
    expect(rows.find((r) => r.file_id === bad[3]?.id)?.error_code).toBe("policy_exclude");
  });

  it("adopts the item a crashed run left behind instead of making a second copy, and never overwrites a stranger's file", async () => {
    const jobId = await insertJob(db);
    const link = await provisioned(jobId);
    const file = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "crash.pdf",
      bytes: "12345",
    });
    await queued(jobId, file);
    g.fake.crashAfterNextUpload();
    const crashed = await push(jobId);
    expect(crashed.error ?? crashed.result).toBeDefined();
    const after = (await pushRows(db, jobId))[0];
    expect(["uploading", "failed"]).toContain(after?.status);
    expect(after?.remote_name).toBe("crash.pdf");
    const drive = link.drive_id ?? "";
    const channel = link.channel_name;
    expect(g.fake.itemAt(drive, `${channel}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey/crash.pdf`)).toBeDefined();

    const again = await push(jobId);
    expect(again.result).toEqual({ pushed: 1, failed: 0, skipped: 0, deleted: 0 });
    expect(results).toContain("adopted");
    const folder = g.fake.itemAt(drive, `${channel}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey`);
    const copies = [...g.fake.items(drive).values()].filter(
      (i) => i.parentId === folder?.id && i.name.startsWith("crash"),
    );
    expect(copies).toHaveLength(1);

    // a file of the same name made by a person is left alone: the app's copy takes the next name
    const other = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "theirs.pdf",
      bytes: "ours",
    });
    g.fake.seed(drive, folder?.id ?? "", "theirs.pdf", Buffer.from("theirs"), "person");
    await queued(jobId, other, "failed", { remote_name: "theirs.pdf" });
    expect((await push(jobId)).result?.pushed).toBe(1);
    expect(
      g.fake.itemAt(drive, `${channel}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey/theirs.pdf`)?.content,
    ).toEqual(Buffer.from("theirs"));
    expect(
      g.fake.itemAt(drive, `${channel}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey/theirs (2).pdf`)?.content,
    ).toEqual(Buffer.from("ours"));
  });

  it("uploads a large file through a session in 10 MiB chunks with no Authorization header", async () => {
    const jobId = await insertJob(db);
    const link = await provisioned(jobId);
    const size = UPLOAD_CHUNK_BYTES + 1234;
    const big = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "big.pdf",
      bytes: Buffer.alloc(size, 7),
    });
    await queued(jobId, big);
    expect((await push(jobId)).result?.pushed).toBe(1);
    const chunks = g.fake.requests.filter((r) => r.path.startsWith("/_upload/"));
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c.headers.authorization).toBeUndefined();
    const item = g.fake.itemAt(
      link.drive_id ?? "",
      `${link.channel_name}/${ROOT}/01 Preliminaries/2.0 Site Feature Survey/big.pdf`,
    );
    expect(item?.content.byteLength).toBe(size);
  });

  it("stops the batch and requeues on throttling, marks a refused file failed and carries on, and gives up after the attempt limit", async () => {
    const jobId = await insertJob(db);
    await provisioned(jobId);
    const one = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "one.pdf",
    });
    const two = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "two.pdf",
    });
    await queued(jobId, one);
    await queued(jobId, two);
    g.fake.failNext(4, { status: 429, retryAfter: "1" }); // one attempt and its three retries
    const throttled = await push(jobId);
    expect(throttled.error).toMatchObject({ code: "graph_unavailable", retryable: true });
    const rows = await pushRows(db, jobId);
    expect(rows.find((r) => r.file_id === one.id)).toMatchObject({
      status: "failed",
      error_code: "graph_unavailable",
      attempts: 1,
    });
    expect(rows.find((r) => r.file_id === two.id)?.status).toBe("pending");

    const ok = await push(jobId);
    expect(ok.result).toEqual({ pushed: 2, failed: 0, skipped: 0, deleted: 0 });

    const gone = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "gone.pdf",
      noObject: true,
    });
    await queued(jobId, gone);
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 1, skipped: 0, deleted: 0 });
    expect((await pushRows(db, jobId)).find((r) => r.file_id === gone.id)).toMatchObject({
      status: "failed",
      error_code: "object_missing",
    });
    await db
      .updateTable("teams_file_pushes")
      .set({ attempts: PUSH_MAX_ATTEMPTS })
      .where("file_id", "=", gone.id)
      .execute();
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 0, skipped: 0, deleted: 0 });
  });

  it("copies fee-proposal files only to the job's subfolder in the Fee Proposals channel under the restricted policy", async () => {
    await configureTeams(db, { feePolicy: "restricted" });
    const feeSite = g.fake.addSite(`${SITE}-FeeProposals`, { displayName: "Fee Proposals" });
    g.fake.seed(feeSite.driveId, feeSite.rootId, "Fee Proposals");
    const jobId = await insertJob(db);
    const link = await provisioned(jobId);
    const fee = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i1_0p",
      slot: "documents",
      name: "fee.pdf",
      bytes: "FEE",
    });
    const plain = await insertFile(db, storage, jobId, {
      scanStatus: "clean",
      checkpointKey: "i2_0",
      slot: "survey",
      name: "plan.pdf",
    });
    await queued(jobId, fee);
    await queued(jobId, plain);
    expect((await push(jobId)).result).toEqual({ pushed: 2, failed: 0, skipped: 0, deleted: 0 });
    const jobNumber = (
      await db.selectFrom("jobs").select("job_number").where("id", "=", jobId).executeTakeFirstOrThrow()
    ).job_number;
    expect(g.fake.itemAt(feeSite.driveId, `Fee Proposals/${jobNumber}/fee.pdf`)?.content).toEqual(Buffer.from("FEE"));
    const channelDrive = link.drive_id ?? "";
    const inChannel = [...g.fake.items(channelDrive).values()].filter((i) => i.name === "fee.pdf");
    expect(inChannel).toEqual([]);
    expect((await pushRows(db, jobId)).find((r) => r.file_id === fee.id)?.remote_path).toBe(
      `Fee Proposals/${jobNumber}/fee.pdf`,
    );

    // rows parked while the policy was exclude become due once it is restricted
    await db
      .updateTable("teams_file_pushes")
      .set({ status: "excluded", error_code: "fee_proposal_pending" })
      .where("file_id", "=", fee.id)
      .execute();
    g.fake
      .items(feeSite.driveId)
      .delete(g.fake.itemAt(feeSite.driveId, `Fee Proposals/${jobNumber}/fee.pdf`)?.id ?? "");
    expect((await push(jobId)).result?.pushed).toBe(1);
  });

  it("is a no-op with copying off or the link not ready, leaving the rows pending", async () => {
    const jobId = await insertJob(db);
    await provisioned(jobId);
    const file = await insertFile(db, storage, jobId, { scanStatus: "clean", checkpointKey: "i2_0", slot: "survey" });
    await queued(jobId, file);
    await configureTeams(db, { syncEnabled: false });
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 0, skipped: 1, deleted: 0 });
    await configureTeams(db);
    await db.updateTable("job_teams_links").set({ status: "error" }).where("job_id", "=", jobId).execute();
    expect((await push(jobId)).result).toEqual({ pushed: 0, failed: 0, skipped: 1, deleted: 0 });
    expect((await pushRows(db, jobId))[0]?.status).toBe("pending");
  });
});

describe("the file-scan hook", () => {
  let clamd: FakeClamd;
  beforeEach(async () => {
    clamd = await startFakeClamd();
  });
  afterEach(async () => {
    await clamd.stop();
  });

  async function scan(jobId: string, file: { id: string }, flagOn = true) {
    const op = await enqueue(db, jobId, "file.scan", { fileId: file.id });
    const handler = fileScanHandler({
      db,
      storage,
      clamd: createClamdClient({ host: "127.0.0.1", port: clamd.port, timeoutMs: 5000, maxBytes: 1024 * 1024 }),
      config: { MALWARE_SCAN_MODE: "required", CLAMAV_TIMEOUT_MS: 5000, SCAN_ERROR_MAX_RETRIES: 3 },
      metrics: { recordFileScan: () => undefined },
      flags: staticFlags({ "teams-file-sync": flagOn }),
    });
    return handler.run(handlerContext(op));
  }

  it("queues a push for a clean file of a linked job in the scan's transaction, and nothing otherwise", async () => {
    const jobId = await insertJob(db);
    await provisioned(jobId);
    const file = await insertFile(db, storage, jobId, { checkpointKey: "i2_0", slot: "survey" });
    await scan(jobId, file);
    expect((await pushRows(db, jobId)).map((r) => [r.file_id, r.status])).toEqual([[file.id, "pending"]]);
    const ops = await db
      .selectFrom("operations")
      .select("status")
      .where("type", "=", "teams.push")
      .where("job_id", "=", jobId)
      .execute();
    expect(ops).toEqual([{ status: "queued" }]);

    const fee = await insertFile(db, storage, jobId, { checkpointKey: "i1_0p", slot: "documents" });
    await scan(jobId, fee);
    expect((await pushRows(db, jobId)).find((r) => r.file_id === fee.id)?.status).toBe("excluded");

    const unlinked = await insertJob(db);
    const loose = await insertFile(db, storage, unlinked, { checkpointKey: "i2_0", slot: "survey" });
    await scan(unlinked, loose);
    expect(await pushRows(db, unlinked)).toEqual([]);

    const off = await insertFile(db, storage, jobId, { checkpointKey: "i2_0", slot: "survey" });
    await scan(jobId, off, false);
    expect((await pushRows(db, jobId)).find((r) => r.file_id === off.id)).toBeUndefined();
  });
});
