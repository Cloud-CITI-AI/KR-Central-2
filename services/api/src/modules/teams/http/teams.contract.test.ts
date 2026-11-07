/**
 * The Teams operations answer exactly what packages/contracts/openapi.yaml declares (ADR-0015, PRODUCT_SPEC §5.10 and
 * §9.3): settings for admins, the job link for staff, 404 for externals and for a deployment whose flag is off.
 */
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  createTestApp,
  signIn,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { registeredOperations } from "../../../app.js";
import { teamsSettingsModule } from "../../teams-settings/index.js";
import { teamsModule } from "../index.js";

function conforms(operationId: string, status: number, res: LightMyRequestResponse): void {
  expect(res.statusCode, `${operationId}: ${res.body.slice(0, 200)}`).toBe(status);
  if (status === 204) return;
  const type = status >= 400 ? "application/problem+json" : "application/json";
  expect(contractViolations(operationId, status, res.json(), type), `${operationId} ${status}`).toEqual([]);
}

const TEAM = "11111111-2222-4333-8444-555555555555";
const OTHER_TEAM = "22222222-2222-4222-8222-222222222222";
const SETTINGS = "/v1/admin/teams-settings";
const channelLink = (tenant: string, team = TEAM, channel = `19:${Date.now().toString(16)}@thread.tacv2`) =>
  `https://teams.microsoft.com/l/channel/${encodeURIComponent(channel)}/General?groupId=${team}&tenantId=${tenant}`;
const body = (over: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  teamSiteUrl: "https://contoso.sharepoint.com/sites/TeamSurvey",
  feeChannelLink: null,
  feeSiteUrl: null,
  rootFolder: "102. Subdivision Tracker",
  feeProposalPolicy: "exclude",
  syncEnabled: true,
  inboundSyncEnabled: false,
  createChannelsEnabled: false,
  inboundPollSeconds: 300,
  ...over,
});

describe("teams modules contract (flag on)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn;
  let tenant: string;
  const get = (as: SignedIn | undefined, url: string) => apiRequest(t, { url, ...(as ? { as } : {}) });
  const put = (as: SignedIn | undefined, url: string, payload: unknown, ifMatch?: string) =>
    apiRequest(t, {
      method: "PUT",
      url,
      body: payload,
      ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
      ...(as ? { as } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp({ flags: { "teams-file-sync": true } });
    f = createFactories(t.db);
    tenant = t.deps.config.ENTRA_TENANT_ID;
    const mfa = { amr: ["pwd", "mfa"] };
    [admin, krAdmin, staff, client] = [
      await signIn(t, await f.makeUser({ role: "admin" }), mfa),
      await signIn(t, await f.makeUser({ role: "kr_admin" }), mfa),
      await signIn(t, await f.makeUser({ role: "staff" })),
      await signIn(t, await f.makeUser({ role: "external" })),
    ];
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers every operation of both modules through defineRoute", () => {
    for (const id of [...teamsSettingsModule.operations, ...teamsModule.operations])
      expect(registeredOperations(t.app), id).toContain(id);
  });

  it("getTeamsSettings conforms: 200 for admin and kr_admin, 401, 403 for staff", async () => {
    const res = await get(admin, SETTINGS);
    conforms("getTeamsSettings", 200, res);
    expect(res.json()).toMatchObject({ teamId: null, syncEnabled: false, version: 1, lastCheck: null });
    expect(res.headers.etag).toBe('"1"');
    conforms("getTeamsSettings", 200, await get(krAdmin, SETTINGS));
    conforms("getTeamsSettings", 401, await get(undefined, SETTINGS));
    conforms("getTeamsSettings", 403, await get(staff, SETTINGS));
  });

  it("updateTeamsSettings conforms: 428 without If-Match, 400 (switch order, fee link), 403 for kr_admin, 200 audited, 412 stale", async () => {
    conforms("updateTeamsSettings", 428, await put(admin, SETTINGS, body()));
    conforms(
      "updateTeamsSettings",
      400,
      await put(admin, SETTINGS, body({ inboundSyncEnabled: true, syncEnabled: false }), '"1"'),
    );
    conforms("updateTeamsSettings", 400, await put(admin, SETTINGS, body({ syncEnabled: true, teamId: null }), '"1"'));
    const badFee = await put(admin, SETTINGS, body({ feeChannelLink: "not a link" }), '"1"');
    conforms("updateTeamsSettings", 400, badFee);
    expect(badFee.json<{ type: string }>().type).toBe("urn:kr:problem:invalid-channel-link");
    const otherTeamFee = await put(admin, SETTINGS, body({ feeChannelLink: channelLink(tenant, OTHER_TEAM) }), '"1"');
    expect(otherTeamFee.json<{ type: string }>().type).toBe("urn:kr:problem:wrong-team");
    conforms("updateTeamsSettings", 403, await put(krAdmin, SETTINGS, body(), '"1"'));
    const saved = await put(
      admin,
      SETTINGS,
      body({ feeChannelLink: channelLink(tenant, TEAM, "19:fee@thread.tacv2") }),
      '"1"',
    );
    conforms("updateTeamsSettings", 200, saved);
    expect(saved.json()).toMatchObject({
      teamId: TEAM,
      syncEnabled: true,
      feeChannelId: "19:fee@thread.tacv2",
      version: 2,
      updatedBy: { id: admin.user.id },
    });
    conforms("updateTeamsSettings", 412, await put(admin, SETTINGS, body({ syncEnabled: false }), '"1"'));
    const events = await t.db
      .selectFrom("audit_events")
      .select(["action", "changes"])
      .where("entity_type", "=", "teams_settings")
      .execute();
    expect(events.map((e) => e.action)).toContain("settings.teams_updated");
    const changes = events.find((e) => e.action === "settings.teams_updated")?.changes as Record<string, unknown>;
    expect(Object.keys(changes).sort()).toEqual(["fee_channel_id", "sync_enabled", "team_id", "team_site_url"]);
  });

  it("checkTeamsConnection conforms: 202 then 409 while it runs, 403 for kr_admin, and the task is readable", async () => {
    const started = await apiRequest(t, { method: "POST", url: `${SETTINGS}/checks`, as: admin });
    conforms("checkTeamsConnection", 202, started);
    const { operationId } = started.json<{ operationId: string }>();
    conforms(
      "checkTeamsConnection",
      409,
      await apiRequest(t, { method: "POST", url: `${SETTINGS}/checks`, as: admin }),
    );
    conforms(
      "checkTeamsConnection",
      403,
      await apiRequest(t, { method: "POST", url: `${SETTINGS}/checks`, as: krAdmin }),
    );
    const op = await get(krAdmin, `/v1/operations/${operationId}`);
    conforms("getOperation", 200, op);
    expect(op.json()).toMatchObject({ jobId: null, type: "teams.check", status: "queued" });
    conforms("getOperation", 403, await get(staff, `/v1/operations/${operationId}`));
    expect((await get(admin, SETTINGS)).json<{ lastCheck: { operationId: string } }>().lastCheck.operationId).toBe(
      operationId,
    );
  });

  it("the job link conforms: not linked, 202 on link with the task queued, relink, 409 for a taken channel, 204 unlink", async () => {
    const job = await f.makeJob();
    const url = `/v1/jobs/${job.id}/teams-link`;
    const first = await get(staff, url);
    conforms("getJobTeamsLink", 200, first);
    expect(first.json()).toMatchObject({ state: "not_linked", canLink: false, version: null });

    const link = channelLink(tenant);
    const linked = await put(krAdmin, url, { channelLink: link });
    conforms("linkJobTeamsChannel", 202, linked);
    const dto = linked.json<{ state: string; operationId: string; channelName: string; version: number }>();
    expect(dto).toMatchObject({ state: "provisioning", channelName: "General", version: 1, canLink: true });
    const queued = await t.db
      .selectFrom("operations")
      .select(["type", "status"])
      .where("id", "=", dto.operationId)
      .executeTakeFirstOrThrow();
    expect(queued).toEqual({ type: "teams.provision", status: "queued" });
    expect((await get(admin, url)).json()).toMatchObject({ state: "provisioning", operationId: dto.operationId });

    const other = await f.makeJob();
    const taken = await put(admin, `/v1/jobs/${other.id}/teams-link`, { channelLink: link });
    conforms("linkJobTeamsChannel", 409, taken);
    expect(taken.json<{ type: string; detail: string }>()).toMatchObject({
      type: "urn:kr:problem:channel-already-linked",
      detail: `That channel is already linked to job ${job.job_number}.`,
    });

    const relinked = await put(admin, url, { channelLink: channelLink(tenant, TEAM, "19:second@thread.tacv2") }, '"1"');
    conforms("linkJobTeamsChannel", 202, relinked);
    expect(relinked.json()).toMatchObject({ version: 2 });
    conforms("linkJobTeamsChannel", 412, await put(admin, url, { channelLink: link }, '"1"'));

    conforms("unlinkJobTeamsChannel", 204, await apiRequest(t, { method: "DELETE", url, as: admin }));
    conforms("unlinkJobTeamsChannel", 204, await apiRequest(t, { method: "DELETE", url, as: admin }));
    expect((await get(staff, url)).json()).toMatchObject({ state: "not_linked" });
    const actions = (await t.db.selectFrom("audit_events").select("action").where("job_id", "=", job.id).execute()).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["job.teams_linked", "job.teams_relinked", "job.teams_unlinked"]));
  });

  it("linkJobTeamsChannel refuses bad links with the right problem types, and staff with 403", async () => {
    const job = await f.makeJob();
    const url = `/v1/jobs/${job.id}/teams-link`;
    const invalid = await put(admin, url, { channelLink: "https://example.test/not-teams" });
    conforms("linkJobTeamsChannel", 400, invalid);
    expect(invalid.json<{ type: string }>().type).toBe("urn:kr:problem:invalid-channel-link");
    const wrongTeam = await put(admin, url, { channelLink: channelLink(tenant, OTHER_TEAM) });
    conforms("linkJobTeamsChannel", 400, wrongTeam);
    expect(wrongTeam.json<{ type: string }>().type).toBe("urn:kr:problem:wrong-team");
    const wrongTenant = await put(admin, url, { channelLink: channelLink(OTHER_TEAM, TEAM) });
    expect(wrongTenant.json<{ type: string }>().type).toBe("urn:kr:problem:wrong-tenant");
    conforms("linkJobTeamsChannel", 403, await put(staff, url, { channelLink: channelLink(tenant) }));
    conforms("linkJobTeamsChannel", 401, await put(undefined, url, { channelLink: channelLink(tenant) }));
  });

  it("the Unfiled list conforms: items with problems flagged, filing queues a teams.poll and refuses a second time, dismiss hides", async () => {
    const job = await f.makeJob();
    await t.db
      .insertInto("job_teams_links")
      .values({
        job_id: job.id,
        team_id: TEAM,
        channel_id: "19:unfiled@thread.tacv2",
        channel_name: "General",
        teams_url: "https://teams.microsoft.com/l/channel/x/y",
        status: "ready",
      })
      .execute();
    await t.db
      .insertInto("teams_inbound_items")
      .values([
        {
          job_id: job.id,
          drive_item_id: "01A",
          remote_path: "notes.pdf",
          name: "notes.pdf",
          size_bytes: 10,
          status: "unfiled",
          modified_by_name: "Sam Surveyor",
        },
        {
          job_id: job.id,
          drive_item_id: "01B",
          remote_path: "huge.mp4",
          name: "huge.mp4",
          size_bytes: 10 ** 12,
          status: "unfiled",
        },
        { job_id: job.id, drive_item_id: "01C", remote_path: "done.pdf", name: "done.pdf", status: "imported" },
      ])
      .execute();
    const url = `/v1/jobs/${job.id}/teams-unfiled`;
    const list = await get(staff, url);
    conforms("listTeamsUnfiled", 200, list);
    const items = list.json<{ items: { itemId: string; problem: string | null; addedBy: string | null }[] }>().items;
    expect(items.map((i) => [i.itemId, i.problem])).toEqual([
      ["01A", null],
      ["01B", "too_large"],
    ]);
    expect(items[0]?.addedBy).toBe("Sam Surveyor");
    conforms("listTeamsUnfiled", 404, await get(client, url));
    expect((await get(admin, `/v1/jobs/${job.id}/teams-link`)).json()).toMatchObject({ counts: { unfiled: 2 } });

    const filed = await apiRequest(t, {
      method: "POST",
      url: `${url}/01A/file`,
      body: { checkpointKey: "i2_0", slot: "survey" },
      as: staff,
    });
    conforms("fileTeamsUnfiled", 202, filed);
    const op = await t.db
      .selectFrom("operations")
      .select(["type", "payload"])
      .where("id", "=", filed.json<{ operationId: string }>().operationId)
      .executeTakeFirstOrThrow();
    expect(op.type).toBe("teams.poll");
    expect(op.payload).toEqual({ import: { itemId: "01A", checkpointKey: "i2_0", slot: "survey" } });
    conforms(
      "fileTeamsUnfiled",
      409,
      await apiRequest(t, {
        method: "POST",
        url: `${url}/01A/file`,
        body: { checkpointKey: "i2_0", slot: "survey" },
        as: staff,
      }),
    );
    conforms(
      "fileTeamsUnfiled",
      409,
      await apiRequest(t, {
        method: "POST",
        url: `${url}/01B/file`,
        body: { checkpointKey: "i2_0", slot: "survey" },
        as: staff,
      }),
    );
    conforms(
      "fileTeamsUnfiled",
      400,
      await apiRequest(t, {
        method: "POST",
        url: `${url}/01B/file`,
        body: { checkpointKey: "i2_0", slot: "nope" },
        as: staff,
      }),
    );
    conforms(
      "fileTeamsUnfiled",
      404,
      await apiRequest(t, {
        method: "POST",
        url: `${url}/01Z/file`,
        body: { checkpointKey: "i2_0", slot: "survey" },
        as: staff,
      }),
    );

    conforms("dismissTeamsUnfiled", 204, await apiRequest(t, { method: "POST", url: `${url}/01B/dismiss`, as: staff }));
    expect((await get(staff, url)).json<{ items: unknown[] }>().items).toEqual([]);
    conforms("dismissTeamsUnfiled", 404, await apiRequest(t, { method: "POST", url: `${url}/01Z/dismiss`, as: staff }));
  });

  it("phase 3: lists cached channels with the generated name, refuses a job whose channel name is taken, queues creation otherwise, and the panel's CREATE CHANNEL", async () => {
    await put(
      admin,
      SETTINGS,
      body({
        feeChannelLink: channelLink(tenant, TEAM, "19:fee@thread.tacv2"),
        inboundSyncEnabled: true,
        createChannelsEnabled: true,
      }),
      String((await get(admin, SETTINGS)).headers.etag),
    );
    await t.db
      .insertInto("teams_channels")
      .values([
        {
          team_id: TEAM,
          channel_id: "19:gen@thread.tacv2",
          display_name: "General",
          folder_name: "General",
          membership_type: "standard",
        },
        {
          team_id: TEAM,
          channel_id: "19:fee@thread.tacv2",
          display_name: "Fee Proposals",
          folder_name: null,
          membership_type: "private",
        },
        {
          team_id: TEAM,
          channel_id: "19:taken@thread.tacv2",
          display_name: "S-T1_1 TAKEN RD (Client)",
          folder_name: "S-T1_1 TAKEN RD (Client)",
          membership_type: "standard",
        },
      ])
      .execute();
    const list = await get(staff, "/v1/teams/channels?jobNumber=T1&address=1 Taken Rd&clientName=Client");
    conforms("listTeamsChannels", 200, list);
    expect(list.json()).toMatchObject({
      channels: [{ displayName: "General" }, { displayName: "S-T1_1 TAKEN RD (Client)" }],
      channelName: "S-T1_1 TAKEN RD (Client)",
      nameTaken: true,
      createEnabled: true,
    });
    conforms("listTeamsChannels", 403, await get(client, "/v1/teams/channels"));

    const refused = await apiRequest(t, {
      method: "POST",
      url: "/v1/jobs",
      body: { jobNumber: "T1", address: "1 Taken Rd", clientName: "Client", subdivisionType: "Survey-Strata" },
      headers: { "idempotency-key": "teams-contract-refused-1" },
      as: staff,
    });
    conforms("createJob", 409, refused);
    expect(refused.json<{ type: string }>().type).toBe("urn:kr:problem:channel-name-exists");

    const created = await apiRequest(t, {
      method: "POST",
      url: "/v1/jobs",
      body: { jobNumber: "T2", address: "2 Free Rd", clientName: "Client", subdivisionType: "Survey-Strata" },
      headers: { "idempotency-key": "teams-contract-created-1" },
      as: staff,
    });
    conforms("createJob", 201, created);
    const jobId = created.json<{ id: string }>().id;
    const queued = await t.db
      .selectFrom("operations")
      .select(["type", "payload"])
      .where("job_id", "=", jobId)
      .where("type", "=", "teams.create_channel")
      .executeTakeFirstOrThrow();
    expect(queued.payload).toEqual({ name: "S-T2_2 FREE RD (Client)" });
    expect((await get(staff, `/v1/jobs/${jobId}/teams-link`)).json()).toMatchObject({
      state: "provisioning",
      createEnabled: true,
    });

    const unticked = await apiRequest(t, {
      method: "POST",
      url: "/v1/jobs",
      body: { jobNumber: "T3", address: "3 Free Rd", subdivisionType: "Survey-Strata", createTeamsChannel: false },
      headers: { "idempotency-key": "teams-contract-unticked-1" },
      as: staff,
    });
    conforms("createJob", 201, unticked);
    const plain = unticked.json<{ id: string }>().id;
    expect(
      await t.db
        .selectFrom("operations")
        .select("id")
        .where("job_id", "=", plain)
        .where("type", "=", "teams.create_channel")
        .executeTakeFirst(),
    ).toBeUndefined();
    const start = await apiRequest(t, { method: "POST", url: `/v1/jobs/${plain}/teams-link/create`, as: admin });
    conforms("createJobTeamsChannel", 202, start);
    conforms(
      "createJobTeamsChannel",
      403,
      await apiRequest(t, { method: "POST", url: `/v1/jobs/${plain}/teams-link/create`, as: staff }),
    );
    await t.db
      .updateTable("operations")
      .set({ status: "failed", error_code: "graph_unavailable" })
      .where("id", "=", start.json<{ operationId: string }>().operationId)
      .execute();
    expect((await get(staff, `/v1/jobs/${plain}/teams-link`)).json()).toMatchObject({
      state: "not_created",
      errorCode: "graph_unavailable",
    });
  });

  it("hides the panel from externals and unknown jobs alike (404), and shows sync_off when copying is turned off", async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    const url = `/v1/jobs/${job.id}/teams-link`;
    conforms("getJobTeamsLink", 404, await get(client, url));
    conforms("linkJobTeamsChannel", 404, await put(client, url, { channelLink: channelLink(tenant) }));
    conforms("unlinkJobTeamsChannel", 404, await apiRequest(t, { method: "DELETE", url, as: client }));
    conforms("getJobTeamsLink", 404, await get(admin, "/v1/jobs/0f8fad5b-d9cb-469f-a165-70867728950e/teams-link"));

    const current = await get(admin, SETTINGS);
    const off = await put(
      admin,
      SETTINGS,
      body({ syncEnabled: false, feeChannelLink: channelLink(tenant, TEAM, "19:fee@thread.tacv2") }),
      String(current.headers.etag),
    );
    conforms("updateTeamsSettings", 200, off);
    expect((await get(staff, url)).json()).toMatchObject({ state: "sync_off" });
    conforms("linkJobTeamsChannel", 409, await put(admin, url, { channelLink: channelLink(tenant) }));
  });
});

describe("teams modules contract (flag off)", () => {
  let t: TestApp;
  let admin: SignedIn;
  beforeAll(async () => {
    t = await createTestApp();
    const f = createFactories(t.db, 7);
    admin = await signIn(t, await f.makeUser({ role: "admin" }), { amr: ["pwd", "mfa"] });
  });
  afterAll(async () => {
    await t.close();
  });

  it("answers 404 on every Teams route and reports the feature off in getMe", async () => {
    const job = "0f8fad5b-d9cb-469f-a165-70867728950e";
    conforms("getTeamsSettings", 404, await apiRequest(t, { url: SETTINGS, as: admin }));
    conforms(
      "updateTeamsSettings",
      404,
      await apiRequest(t, { method: "PUT", url: SETTINGS, body: body(), headers: { "if-match": '"1"' }, as: admin }),
    );
    conforms(
      "checkTeamsConnection",
      404,
      await apiRequest(t, { method: "POST", url: `${SETTINGS}/checks`, as: admin }),
    );
    conforms("getJobTeamsLink", 404, await apiRequest(t, { url: `/v1/jobs/${job}/teams-link`, as: admin }));
    conforms(
      "linkJobTeamsChannel",
      404,
      await apiRequest(t, { method: "PUT", url: `/v1/jobs/${job}/teams-link`, body: { channelLink: "x" }, as: admin }),
    );
    conforms(
      "unlinkJobTeamsChannel",
      404,
      await apiRequest(t, { method: "DELETE", url: `/v1/jobs/${job}/teams-link`, as: admin }),
    );
    const me = await apiRequest(t, { url: "/v1/me", as: admin });
    expect(me.json<{ features: { teamsFileSync: boolean } }>().features.teamsFileSync).toBe(false);
  });
});
