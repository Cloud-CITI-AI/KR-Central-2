/**
 * teams.create_channel and teams.list_channels against the fake (WP-27): a standard channel with the three template
 * folders, the link and a queued provisioning; a reused name gets " (2)"; no permission is an error; the cache
 * refresh; the scheduler queues a refresh when the cache is stale.
 */
import type { Db } from "@kr/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { handlerContext } from "../../test/files.js";
import { ROOT, SITE, TEAM, configureTeams, linkRow, startGraph, type GraphHarness } from "../../test/teams.js";
import { createGraphTeamsClient } from "../clients/graph-teams.js";
import { staticFlags } from "../flags.js";
import { scheduleDuePolls } from "../sweeps/teams-poll-schedule.js";
import { teamsCreateChannelHandler } from "./teams-create-channel.js";
import { teamsListChannelsHandler } from "./teams-list-channels.js";

let db: Db;
let g: GraphHarness;
const flags = staticFlags({ "teams-file-sync": true });
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
  await db.deleteFrom("teams_channels").execute();
  g = await startGraph();
  await configureTeams(db);
  await db
    .updateTable("teams_settings")
    .set({ inbound_sync_enabled: true, create_channels_enabled: true })
    .where("singleton", "=", true)
    .execute();
});
afterEach(async () => {
  await g.fake.stop();
});

function deps() {
  const teams = createGraphTeamsClient(g.graph.request.bind(g.graph), g.graph.sleep);
  return {
    db,
    flags,
    clock: g.clock,
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000, TEAMS_TENANT_ID: g.fake.tenantId },
    graph: g.graph,
    teams,
  };
}
async function create(jobId: string, name: string) {
  const op = await enqueue(db, jobId, "teams.create_channel", { name });
  return (await teamsCreateChannelHandler(deps()).run(handlerContext(op))) as {
    status: string;
    channelName: string | null;
    errorCode: string | null;
  };
}

describe("teams.create_channel", () => {
  it("creates a standard channel with the template folders, links the job and queues provisioning", async () => {
    const site = g.fake.addSite(SITE, { displayName: "Team Survey" });
    g.fake.addTeam(TEAM, site);
    g.fake.delayFilesFolder(2);
    const jobId = await insertJob(db);
    expect(await create(jobId, "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)")).toEqual({
      status: "created",
      channelName: "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)",
      errorCode: null,
    });
    expect(g.fake.channels(TEAM).map((c) => c.name)).toEqual(["S-0042_1 EXAMPLE RD, SUBURB (CLIENT)"]);
    for (const folder of ["100. Initial SURVEY", "101. Subdivison Process", ROOT]) {
      expect(g.fake.itemAt(site.driveId, `S-0042_1 EXAMPLE RD, SUBURB (CLIENT)/${folder}`)?.isFolder, folder).toBe(
        true,
      );
    }
    const link = await linkRow(db, jobId);
    expect(link).toMatchObject({
      status: "provisioning",
      channel_name: "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)",
      team_id: TEAM,
      team_site_url: SITE,
    });
    expect(link.teams_url).toContain(`tenantId=${g.fake.tenantId}`);
    const ops = await db
      .selectFrom("operations")
      .select("type")
      .where("job_id", "=", jobId)
      .where("type", "=", "teams.provision")
      .execute();
    expect(ops).toHaveLength(1);
    // a re-run finds the link and creates nothing more
    expect((await create(jobId, "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)")).status).toBe("created");
    expect(g.fake.channels(TEAM)).toHaveLength(1);
  });

  it("takes the next suffix for a name already in the team, and reports a missing permission", async () => {
    const site = g.fake.addSite(SITE);
    g.fake.addTeam(TEAM, site);
    g.fake.addChannel(TEAM, "S-0042_1 EXAMPLE RD");
    const jobId = await insertJob(db);
    expect((await create(jobId, "S-0042_1 EXAMPLE RD")).channelName).toBe("S-0042_1 EXAMPLE RD (2)");

    const other = await insertJob(db);
    g.fake.addTeam(TEAM, site, { createAllowed: false });
    expect(await create(other, "S-0043_2 EXAMPLE RD")).toMatchObject({
      status: "error",
      errorCode: "permission_denied",
    });
    expect(
      await db.selectFrom("job_teams_links").select("job_id").where("job_id", "=", other).executeTakeFirst(),
    ).toBeUndefined();
  });

  it("is a no-op when channel creation is off", async () => {
    await db
      .updateTable("teams_settings")
      .set({ create_channels_enabled: false })
      .where("singleton", "=", true)
      .execute();
    expect(await create(await insertJob(db), "S-1_X")).toMatchObject({ status: "skipped" });
  });
});

describe("teams.list_channels and the cache refresh", () => {
  it("caches the team's channels with their membership type, and the scheduler queues a refresh when stale", async () => {
    const site = g.fake.addSite(SITE);
    g.fake.addTeam(TEAM, site);
    g.fake.addChannel(TEAM, "General");
    g.fake.addChannel(TEAM, "Fee Proposals", "private");
    expect(await scheduleDuePolls(db, g.clock)).toBe(1);
    const op = await db
      .selectFrom("operations")
      .selectAll()
      .where("type", "=", "teams.list_channels")
      .executeTakeFirstOrThrow();
    expect(op.job_id).toBeNull();
    expect(await teamsListChannelsHandler(deps()).run(handlerContext(op))).toEqual({ channels: 2 });
    const cached = await db
      .selectFrom("teams_channels")
      .select(["display_name", "membership_type", "folder_name"])
      .orderBy("display_name")
      .execute();
    expect(cached).toEqual([
      { display_name: "Fee Proposals", membership_type: "private", folder_name: null },
      { display_name: "General", membership_type: "standard", folder_name: "General" },
    ]);
    await db.updateTable("operations").set({ status: "succeeded" }).where("id", "=", op.id).execute();
    expect(await scheduleDuePolls(db, g.clock)).toBe(0);
  });
});
