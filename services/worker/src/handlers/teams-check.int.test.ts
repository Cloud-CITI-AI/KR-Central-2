/**
 * teams.check against the local Graph fake (PRODUCT_SPEC §9.3): each check in order, a failed prerequisite skips the
 * rest, the probe folder is created and removed, a site without a grant shows 403 accessDenied, the team name is saved,
 * and the flag off or missing settings fail with `teams_not_configured`. Needs the test database (migration 0005).
 */
import { enqueueOperation, type Db } from "@kr/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../test/db.js";
import { startFakeGraph, type FakeGraph } from "../../test/fake-graph.js";
import { handlerContext } from "../../test/files.js";
import type { Clock } from "../clock.js";
import { createGraphDriveClient, type GraphDriveClient } from "../clients/graph-drive.js";
import { createGraphTokenSource } from "../clients/graph-token.js";
import { createGraphTeamsClient } from "../clients/graph-teams.js";
import { TaskError } from "../errors.js";
import { staticFlags } from "../flags.js";
import { PROBE_FOLDER_PREFIX, plannedChecks, teamsCheckHandler } from "./teams-check.js";

const SITE = "https://contoso.sharepoint.com/sites/TeamSurvey";
const FEE_SITE = "https://contoso.sharepoint.com/sites/TeamSurvey-FeeProposals";
const TEAM = "11111111-2222-4333-8444-555555555555";

let db: Db;
let fake: FakeGraph;
let graph: GraphDriveClient;
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
  await db
    .updateTable("teams_settings")
    .set({
      team_id: TEAM,
      team_site_url: SITE,
      team_name: null,
      fee_channel_id: null,
      fee_site_url: null,
      fee_proposal_policy: "exclude",
      sync_enabled: true,
      inbound_sync_enabled: false,
      create_channels_enabled: false,
    })
    .where("singleton", "=", true)
    .execute();
  fake = await startFakeGraph();
  const clock: Clock = { now: () => new Date() };
  graph = createGraphDriveClient({
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
});
afterEach(async () => {
  await fake.stop();
});

interface CheckOutcome {
  readonly results: { item: string; ok: boolean; errorCode: string | null }[];
  readonly skipped: string[];
}

async function run(o: { flagOn?: boolean; withGraph?: boolean } = {}): Promise<{
  result?: CheckOutcome;
  error?: TaskError;
  ctx: ReturnType<typeof handlerContext>;
}> {
  const op = await enqueueOperation(db, { jobId: null, type: "teams.check", payload: {}, createdBy: null });
  const ctx = handlerContext(op);
  const handler = teamsCheckHandler({
    db,
    flags: staticFlags({ "teams-file-sync": o.flagOn ?? true }),
    config: { TEAMS_GRAPH_TIMEOUT_MS: 5000 },
    clock: { now: () => new Date() },
    graph: o.withGraph === false ? undefined : graph,
    teams: o.withGraph === false ? undefined : createGraphTeamsClient(graph.request.bind(graph), graph.sleep),
  });
  const outcome = await handler.run(ctx).then(
    (result) => ({
      result: result as { results: { item: string; ok: boolean; errorCode: string | null }[]; skipped: string[] },
    }),
    (error: unknown) => ({ error: error as TaskError }),
  );
  return { ...outcome, ctx };
}

describe("teams.check", () => {
  it("plans the checks a settings row calls for", () => {
    expect(plannedChecks({ fee_proposal_policy: "exclude", create_channels_enabled: false })).toEqual([
      "token",
      "team_site",
      "team_site_write",
    ]);
    expect(plannedChecks({ fee_proposal_policy: "restricted", create_channels_enabled: true })).toEqual([
      "token",
      "team_site",
      "team_site_write",
      "fee_site",
      "fee_site_write",
      "channel_list",
      "channel_create",
    ]);
  });

  it("passes every check on a writable team site, creating the root folder and removing the probe", async () => {
    const site = fake.addSite(SITE, { displayName: "Team Survey" });
    const { result, ctx } = await run();
    expect(result?.results).toEqual([
      { item: "token", ok: true, errorCode: null },
      { item: "team_site", ok: true, errorCode: null },
      { item: "team_site_write", ok: true, errorCode: null },
    ]);
    expect(result?.skipped).toEqual([]);
    const root = fake.itemAt(site.driveId, "102. Subdivision Tracker");
    expect(root?.isFolder).toBe(true);
    const leftovers = [...fake.items(site.driveId).values()].filter((i) => i.name.startsWith(PROBE_FOLDER_PREFIX));
    expect(leftovers).toEqual([]);
    expect(
      fake.requests.some(
        (r) =>
          r.path.includes(encodeURIComponent(`${PROBE_FOLDER_PREFIX}${ctx.operation.id}`)) ||
          r.body.toString().includes(ctx.operation.id),
      ),
    ).toBe(true);
    const saved = await db.selectFrom("teams_settings").select("team_name").executeTakeFirstOrThrow();
    expect(saved.team_name).toBe("Team Survey");
    expect(JSON.stringify(ctx.captured.lines)).not.toContain("a-test-secret");
  });

  it("reports a missing grant as 403 accessDenied on the write check and keeps the rest of the result", async () => {
    fake.addSite(SITE, { writable: false });
    const { result } = await run();
    expect(result?.results).toEqual([
      { item: "token", ok: true, errorCode: null },
      { item: "team_site", ok: true, errorCode: null },
      { item: "team_site_write", ok: false, errorCode: "403 accessDenied" },
    ]);
  });

  it("fails the site check for an unknown site and skips what depends on it", async () => {
    const { result } = await run();
    expect(result?.results).toEqual([
      { item: "token", ok: true, errorCode: null },
      { item: "team_site", ok: false, errorCode: "404 itemNotFound" },
    ]);
    expect(result?.skipped).toEqual(["team_site_write"]);
  });

  it("fails the token check when Microsoft refuses the registration and skips everything else", async () => {
    fake.addSite(SITE);
    fake.refuseTokens(401);
    const { result } = await run();
    expect(result?.results).toEqual([{ item: "token", ok: false, errorCode: "401 invalid_client" }]);
    expect(result?.skipped).toEqual(["team_site", "team_site_write"]);
  });

  it("checks the Fee Proposals site under the restricted policy and the channel listing of phase 3", async () => {
    const team = fake.addSite(SITE);
    fake.addSite(FEE_SITE, { writable: true });
    fake.addTeam(TEAM, team);
    fake.addChannel(TEAM, "General");
    await db
      .updateTable("teams_settings")
      .set({
        fee_channel_id: "19:fee@thread.tacv2",
        fee_site_url: FEE_SITE,
        fee_proposal_policy: "restricted",
        inbound_sync_enabled: true,
        create_channels_enabled: true,
      })
      .where("singleton", "=", true)
      .execute();
    const { result } = await run();
    expect(result?.results.map((r) => [r.item, r.ok])).toEqual([
      ["token", true],
      ["team_site", true],
      ["team_site_write", true],
      ["fee_site", true],
      ["fee_site_write", true],
      ["channel_list", true],
      ["channel_create", true],
    ]);
    expect(result?.skipped).toEqual([]);
    const cached = await db.selectFrom("teams_channels").select("display_name").where("team_id", "=", TEAM).execute();
    expect(cached.map((c) => c.display_name)).toEqual(["General"]);
  });

  it("fails with teams_not_configured when the flag is off, the client is absent or the team is not set", async () => {
    fake.addSite(SITE);
    expect((await run({ flagOn: false })).error).toMatchObject({ code: "teams_not_configured" });
    expect((await run({ withGraph: false })).error).toBeInstanceOf(TaskError);
    await db
      .updateTable("teams_settings")
      .set({ team_id: null, sync_enabled: false })
      .where("singleton", "=", true)
      .execute();
    expect((await run()).error).toMatchObject({ code: "teams_not_configured" });
  });
});
