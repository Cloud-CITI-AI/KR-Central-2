/** Shared set-up of the Teams handler tests: settings, a linked job, a Graph client against the local fake. */
import { randomUUID } from "node:crypto";
import type { Db, JobTeamsLinkRow } from "@kr/db";
import type { Clock } from "../src/clock.js";
import { createGraphDriveClient, type GraphDriveClient } from "../src/clients/graph-drive.js";
import { createGraphTokenSource } from "../src/clients/graph-token.js";
import { startFakeGraph, type FakeGraph, type FakeSite } from "./fake-graph.js";

export const TEAM = "11111111-2222-4333-8444-555555555555";
export const SITE = "https://contoso.sharepoint.com/sites/TeamSurvey";
export const ROOT = "102. Subdivision Tracker";

export interface GraphHarness {
  readonly fake: FakeGraph;
  readonly graph: GraphDriveClient;
  readonly clock: Clock;
  readonly pushResults: string[];
}

export async function startGraph(): Promise<GraphHarness> {
  const fake = await startFakeGraph();
  const clock: Clock = { now: () => new Date() };
  const pushResults: string[] = [];
  const graph = createGraphDriveClient({
    baseUrl: fake.baseUrl,
    tokens: createGraphTokenSource({
      authorityHost: fake.authorityHost,
      tenantId: fake.tenantId,
      clientId: fake.appId,
      clientSecret: "a-test-secret-of-sixteen-plus",
      clock,
    }),
    timeoutMs: 5000,
    releaseVersion: "test",
    metrics: { recordTeamsGraphRequest: () => undefined },
    clock,
    sleep: () => Promise.resolve(),
  });
  return { fake, graph, clock, pushResults };
}

/** Admin → Teams as saved for the tests: copying on, team and site set. */
export async function configureTeams(db: Db, o: { syncEnabled?: boolean; feePolicy?: "exclude" | "restricted" } = {}) {
  await db
    .updateTable("teams_settings")
    .set({
      team_id: TEAM,
      team_site_url: SITE,
      root_folder: ROOT,
      fee_proposal_policy: o.feePolicy ?? "exclude",
      fee_channel_id: o.feePolicy === "restricted" ? "19:fee@thread.tacv2" : null,
      fee_site_url: o.feePolicy === "restricted" ? `${SITE}-FeeProposals` : null,
      sync_enabled: o.syncEnabled ?? true,
      inbound_sync_enabled: false,
      create_channels_enabled: false,
    })
    .where("singleton", "=", true)
    .execute();
}

/** A channel in the fake team site (its folder at the library root) and a link row for the job. */
export async function linkJob(
  db: Db,
  fake: FakeGraph,
  jobId: string,
  o: { channelName?: string; status?: JobTeamsLinkRow["status"]; site?: FakeSite; withFolder?: boolean } = {},
): Promise<{ site: FakeSite; channelName: string; channelId: string }> {
  const site = o.site ?? fake.site(SITE) ?? fake.addSite(SITE, { displayName: "Team Survey" });
  const channelName = o.channelName ?? `S-${randomUUID().slice(0, 4)}_1 EXAMPLE RD, SUBURB (CLIENT)`;
  if (o.withFolder !== false) fake.seed(site.driveId, site.rootId, channelName);
  const channelId = `19:${randomUUID().replaceAll("-", "")}@thread.tacv2`;
  await db
    .insertInto("job_teams_links")
    .values({
      job_id: jobId,
      team_id: TEAM,
      team_site_url: SITE,
      channel_id: channelId,
      channel_name: channelName,
      teams_url: `https://teams.microsoft.com/l/channel/${encodeURIComponent(channelId)}/x?groupId=${TEAM}&tenantId=${fake.tenantId}`,
      status: o.status ?? "provisioning",
    })
    .execute();
  return { site, channelName, channelId };
}

export function linkRow(db: Db, jobId: string) {
  return db.selectFrom("job_teams_links").selectAll().where("job_id", "=", jobId).executeTakeFirstOrThrow();
}

export function pushRows(db: Db, jobId: string) {
  return db.selectFrom("teams_file_pushes").selectAll().where("job_id", "=", jobId).orderBy("created_at").execute();
}
