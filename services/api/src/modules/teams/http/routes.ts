/**
 * getJobTeamsLink, linkJobTeamsChannel and unlinkJobTeamsChannel (PRODUCT_SPEC §5.10, ADR-0015 decisions 1 and 4).
 * The API parses the pasted link, never fetches it, stores the link and queues `teams.provision` in one transaction;
 * the worker does every Graph call. With the `teams-file-sync` flag off the routes answer 404.
 */
import { PROBLEM_TYPES } from "@kr/contracts";
import { CHECKPOINTS, channelNameFor, safeName, slotsOf } from "@kr/workflow";
import type { FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { requireCapability, requireJobCapability, resolveJobAccess, type JobAccess } from "../../../platform/authz.js";
import { assertVersion, setEtag } from "../../../platform/concurrency.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { checkChannelLink, parseChannelLink, readSettingsRow } from "../../teams-settings/index.js";
import {
  clearFolders,
  deleteLink,
  findChannelOwner,
  findLink,
  queueProvision,
  readLink,
  upsertLink,
} from "../data/teams-links.js";
import { toTeamsLink } from "../domain/link-view.js";
import { toUnfiledItem } from "../domain/unfiled-view.js";
import { findUnfiled, listUnfiled, markUnfiled, queueImport, countUnfiled } from "../data/teams-unfiled.js";
import { latestCreateChannelOp, nameTakenIn, queueCreateChannel, readChannelCache } from "../data/teams-channels.js";

export const LINK_ERRORS = {
  invalid: "That is not a Teams channel link.",
  wrong_team: "That channel is not in the configured team.",
  wrong_tenant: "That channel belongs to another organisation.",
  sync_off: "Teams sync is turned off. An admin can turn it on under Admin → Teams.",
} as const;

export function registerTeamsLinkRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const enabled = () => deps.flags.isEnabled("teams-file-sync");

  /** Externals never learn the panel exists (§5.10): 404 like a job they cannot see; staff without the capability get 403. */
  async function linkAccess(auth: Parameters<typeof resolveJobAccess>[1], jobId: string): Promise<JobAccess> {
    const access = await resolveJobAccess(deps.db, auth, jobId);
    if (!access.capabilities.includes("teams.view")) throw new NotFoundError();
    requireJobCapability(access, "teams.link");
    return access;
  }

  defineRoute(app, "getJobTeamsLink", async ({ auth, reply, params }) => {
    if (!enabled()) throw new NotFoundError();
    const access = await resolveJobAccess(deps.db, auth, params.jobId);
    // Externals never learn the panel exists (§5.10): the same 404 as a job they cannot see.
    if (!access.capabilities.includes("teams.view")) throw new NotFoundError();
    const [settings, read, unfiled, attempt] = await Promise.all([
      readSettingsRow(deps.db),
      readLink(deps.db, params.jobId),
      countUnfiled(deps.db, params.jobId),
      latestCreateChannelOp(deps.db, params.jobId),
    ]);
    if (read) setEtag(reply, read.link.version);
    const resultErrorCode =
      attempt?.result && typeof attempt.result === "object" && "errorCode" in attempt.result
        ? ((attempt.result as { errorCode?: unknown }).errorCode as string | null)
        : null;
    return toTeamsLink({
      jobId: params.jobId,
      settings,
      link: read?.link ?? null,
      linkedBy: read?.linkedBy ?? null,
      counts: read?.counts ?? null,
      unfiled,
      createAttempt: attempt ? { status: attempt.status, errorCode: attempt.error_code, resultErrorCode } : null,
      createEnabled: settings.sync_enabled && settings.create_channels_enabled && settings.team_id !== null,
      provisioningOperationId: read?.provisioning?.id ?? null,
      canLink: access.capabilities.includes("teams.link"),
      canViewFeeProposal: access.capabilities.includes("fee_proposal.view"),
      feeFolderName: safeName(access.job.job_number),
    });
  });

  defineRoute(app, "linkJobTeamsChannel", async ({ auth, request, reply, params, body, expectedVersion }) => {
    if (!enabled()) throw new NotFoundError();
    const access = await linkAccess(auth, params.jobId);
    const parsed = parseChannelLink(body.channelLink);
    if (!parsed.ok) {
      throw new BadRequestError({
        type: PROBLEM_TYPES.invalidChannelLink,
        detail: LINK_ERRORS.invalid,
        errors: [{ path: "channelLink", message: LINK_ERRORS.invalid }],
      });
    }
    const { link: updated, operation } = await withTransaction(deps.db, async (trx) => {
      const settings = await readSettingsRow(trx);
      if (!settings.sync_enabled) throw new ConflictError({ detail: LINK_ERRORS.sync_off });
      const check = checkChannelLink(parsed.link, { teamId: settings.team_id, tenantId: deps.config.ENTRA_TENANT_ID });
      if (check !== "ok") {
        throw new BadRequestError({
          type: check === "wrong_team" ? PROBLEM_TYPES.wrongTeam : PROBLEM_TYPES.wrongTenant,
          detail: LINK_ERRORS[check],
          errors: [{ path: "channelLink", message: LINK_ERRORS[check] }],
        });
      }
      const current = await findLink(trx, params.jobId, true);
      if (current && expectedVersion !== undefined) assertVersion(current.version, expectedVersion);
      const owner = await findChannelOwner(trx, parsed.link.groupId, parsed.link.channelId, params.jobId);
      if (owner) {
        throw new ConflictError({
          type: PROBLEM_TYPES.channelAlreadyLinked,
          detail: `That channel is already linked to job ${owner.job_number}.`,
        });
      }
      if (current) await clearFolders(trx, params.jobId);
      const row = await upsertLink(trx, {
        job_id: params.jobId,
        team_id: parsed.link.groupId,
        team_site_url: settings.team_site_url,
        channel_id: parsed.link.channelId,
        channel_name: parsed.link.channelName,
        teams_url: parsed.link.teamsUrl,
        linked_by: auth.user.id,
      });
      const op = await queueProvision(trx, params.jobId, auth.user.id);
      await audit(trx, auditContext(request), {
        action: current ? "job.teams_relinked" : "job.teams_linked",
        entityType: "job_teams_link",
        entityId: params.jobId,
        jobId: params.jobId,
        changes: {
          channel_id: { from: current?.channel_id ?? null, to: row.channel_id },
          channel_name: { from: current?.channel_name ?? null, to: row.channel_name },
        },
      });
      return { link: row, operation: op };
    });
    const settings = await readSettingsRow(deps.db);
    setEtag(reply, updated.version);
    return toTeamsLink({
      jobId: params.jobId,
      settings,
      link: updated,
      linkedBy: { id: auth.user.id, displayName: auth.user.displayName },
      counts: null,
      provisioningOperationId: operation.id,
      canLink: true,
      canViewFeeProposal: access.capabilities.includes("fee_proposal.view"),
      feeFolderName: safeName(access.job.job_number),
    });
  });

  defineRoute(app, "unlinkJobTeamsChannel", async ({ auth, request, reply, params }) => {
    if (!enabled()) throw new NotFoundError();
    await linkAccess(auth, params.jobId);
    await withTransaction(deps.db, async (trx) => {
      const current = await findLink(trx, params.jobId, true);
      if (!current) return;
      // Pending copies stop with the link; files already in Teams stay there (ADR-0015 decision 7).
      await trx
        .deleteFrom("teams_file_pushes")
        .where("job_id", "=", params.jobId)
        .where("status", "in", ["pending", "failed"])
        .execute();
      await deleteLink(trx, params.jobId);
      await audit(trx, auditContext(request), {
        action: "job.teams_unlinked",
        entityType: "job_teams_link",
        entityId: params.jobId,
        jobId: params.jobId,
        changes: { channel_id: { from: current.channel_id, to: null } },
      });
    });
    return reply.code(204).send();
  });
}

/** The Unfiled list of phase 2 (PRODUCT_SPEC §5.10): what was added in Teams that the app could not place. */
export function registerTeamsUnfiledRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const enabled = () => deps.flags.isEnabled("teams-file-sync");
  const viewAccess = async (auth: Parameters<typeof resolveJobAccess>[1], jobId: string): Promise<JobAccess> => {
    const access = await resolveJobAccess(deps.db, auth, jobId);
    if (!access.capabilities.includes("teams.view")) throw new NotFoundError();
    return access;
  };

  defineRoute(app, "listTeamsUnfiled", async ({ auth, params }) => {
    if (!enabled()) throw new NotFoundError();
    await viewAccess(auth, params.jobId);
    const rows = await listUnfiled(deps.db, params.jobId);
    return {
      items: rows.map((r) => toUnfiledItem(r, deps.config.UPLOAD_MAX_BYTES)),
      uploadMaxBytes: deps.config.UPLOAD_MAX_BYTES,
    };
  });

  defineRoute(app, "fileTeamsUnfiled", async ({ auth, request, params, body }) => {
    if (!enabled()) throw new NotFoundError();
    const access = await viewAccess(auth, params.jobId);
    const target = body.conditionId
      ? { conditionId: body.conditionId }
      : { checkpointKey: body.checkpointKey ?? "", slot: body.slot ?? "" };
    requireJobCapability(access, "conditionId" in target ? "conditions.evidence.upload" : "files.upload.staff_slots");
    if ("checkpointKey" in target) {
      const checkpoint = CHECKPOINTS.find((c) => c.key === target.checkpointKey);
      if (!checkpoint || !slotsOf(checkpoint).some((s) => s.key === target.slot)) {
        throw new BadRequestError({
          detail: "That checkpoint has no such slot.",
          errors: [{ path: "slot", message: "Unknown slot." }],
        });
      }
    }
    const operationId = await withTransaction(deps.db, async (trx) => {
      const item = await findUnfiled(trx, params.jobId, params.itemId, true);
      if (!item) throw new NotFoundError();
      if (item.status !== "unfiled") throw new ConflictError({ detail: "That file is no longer waiting to be filed." });
      if (toUnfiledItem(item, deps.config.UPLOAD_MAX_BYTES).problem !== null) {
        throw new ConflictError({ detail: "That file cannot be brought into the tracker." });
      }
      await markUnfiled(trx, params.jobId, params.itemId, "importing", deps.clock.now());
      const id = await queueImport(trx, params.jobId, params.itemId, target, auth.user.id);
      await audit(trx, auditContext(request), {
        action: "file.teams_filed",
        entityType: "teams_inbound_item",
        entityId: params.itemId,
        jobId: params.jobId,
        changes: { target: { from: null, to: target } },
      });
      return id;
    });
    return { operationId };
  });

  defineRoute(app, "dismissTeamsUnfiled", async ({ auth, request, reply, params }) => {
    if (!enabled()) throw new NotFoundError();
    await viewAccess(auth, params.jobId);
    await withTransaction(deps.db, async (trx) => {
      const item = await findUnfiled(trx, params.jobId, params.itemId, true);
      if (!item) throw new NotFoundError();
      if (item.status === "unfiled") {
        await markUnfiled(trx, params.jobId, params.itemId, "dismissed", deps.clock.now());
        await audit(trx, auditContext(request), {
          action: "file.teams_dismissed",
          entityType: "teams_inbound_item",
          entityId: params.itemId,
          jobId: params.jobId,
        });
      }
    });
    return reply.code(204).send();
  });
}

/** Phase 3 (ADR-0015 A5): the panel's CREATE CHANNEL and the picker's channel list. */
export function registerTeamsChannelRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const enabled = () => deps.flags.isEnabled("teams-file-sync");

  defineRoute(app, "createJobTeamsChannel", async ({ auth, request, params }) => {
    if (!enabled()) throw new NotFoundError();
    const access = await resolveJobAccess(deps.db, auth, params.jobId);
    if (!access.capabilities.includes("teams.view")) throw new NotFoundError();
    requireJobCapability(access, "teams.link");
    const operationId = await withTransaction(deps.db, async (trx) => {
      const settings = await readSettingsRow(trx);
      if (!settings.sync_enabled || !settings.create_channels_enabled || !settings.team_id) {
        throw new ConflictError({ detail: "Channel creation is switched off under Admin → Teams." });
      }
      if (await findLink(trx, params.jobId, true))
        throw new ConflictError({ detail: "This job is already linked to a channel." });
      const job = access.job;
      const name = channelNameFor({ jobNumber: job.job_number, address: job.address, clientName: job.client_name });
      const id = await queueCreateChannel(trx, params.jobId, name, auth.user.id);
      await audit(trx, auditContext(request), {
        action: "job.teams_channel_requested",
        entityType: "job_teams_link",
        entityId: params.jobId,
        jobId: params.jobId,
        changes: { channel_name: { from: null, to: name } },
      });
      return id;
    });
    return { operationId };
  });

  defineRoute(app, "listTeamsChannels", async ({ auth, query }) => {
    if (!enabled()) throw new NotFoundError();
    requireCapability(auth, "jobs.create");
    const settings = await readSettingsRow(deps.db);
    const cache = await readChannelCache(deps.db, settings.team_id);
    const channelName =
      query.jobNumber !== undefined && query.address !== undefined
        ? channelNameFor({ jobNumber: query.jobNumber, address: query.address, clientName: query.clientName ?? null })
        : null;
    return {
      channels: cache.channels
        .filter((c) => c.membership_type === "standard")
        .map((c) => ({ channelId: c.channel_id, displayName: c.display_name })),
      cachedAt: cache.cachedAt ? cache.cachedAt.toISOString() : null,
      channelName,
      nameTaken: channelName !== null && nameTakenIn(cache, channelName),
      createEnabled: settings.sync_enabled && settings.create_channels_enabled && settings.team_id !== null,
      teamId: settings.team_id,
      tenantId: deps.config.ENTRA_TENANT_ID,
    };
  });
}
