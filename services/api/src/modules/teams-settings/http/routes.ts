/**
 * getTeamsSettings, updateTeamsSettings and checkTeamsConnection (PRODUCT_SPEC §9.3, ADR-0015 A2). Admins with MFA
 * evidence edit the one settings row; kr_admin reads it. With the `teams-file-sync` flag off the routes do not exist
 * (404), so a deployment without the integration shows nothing.
 */
import { PROBLEM_TYPES } from "@kr/contracts";
import type { FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { assertMfaForAdmin, requireCapability } from "../../../platform/authz.js";
import { assertVersion, setEtag } from "../../../platform/concurrency.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import {
  findActiveCheck,
  queueCheck,
  readSettings,
  readSettingsRow,
  updateSettingsRow,
} from "../data/teams-settings.js";
import { checkChannelLink, parseChannelLink } from "../domain/channel-link.js";
import { planSettingsUpdate } from "../domain/settings-update.js";
import { toTeamsSettings } from "../domain/settings-view.js";

export const FEE_LINK_ERRORS = {
  invalid: "That is not a Teams channel link.",
  wrong_team: "That channel is not in the configured team.",
  wrong_tenant: "That channel belongs to another organisation.",
} as const;

export function registerTeamsSettingsRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const enabled = () => deps.flags.isEnabled("teams-file-sync");
  const tenantId = deps.config.ENTRA_TENANT_ID;

  defineRoute(app, "getTeamsSettings", async ({ auth, reply }) => {
    if (!enabled()) throw new NotFoundError();
    requireCapability(auth, "teams.settings.read");
    const read = await readSettings(deps.db);
    setEtag(reply, read.row.version);
    return toTeamsSettings({ ...read, tenantId });
  });

  defineRoute(app, "updateTeamsSettings", async ({ auth, request, reply, body, expectedVersion }) => {
    if (!enabled()) throw new NotFoundError();
    requireCapability(auth, "teams.settings.manage");
    assertMfaForAdmin(auth, deps.config);
    // The fee channel link is parsed (never fetched) and must sit in the team the same request sets.
    let feeChannelId: string | null = null;
    if (body.feeChannelLink !== null) {
      const parsed = parseChannelLink(body.feeChannelLink);
      if (!parsed.ok) {
        throw new BadRequestError({
          type: PROBLEM_TYPES.invalidChannelLink,
          detail: FEE_LINK_ERRORS.invalid,
          errors: [{ path: "feeChannelLink", message: FEE_LINK_ERRORS.invalid }],
        });
      }
      const check = checkChannelLink(parsed.link, { teamId: body.teamId, tenantId });
      if (check !== "ok") {
        throw new BadRequestError({
          type: check === "wrong_team" ? PROBLEM_TYPES.wrongTeam : PROBLEM_TYPES.wrongTenant,
          detail: FEE_LINK_ERRORS[check],
          errors: [{ path: "feeChannelLink", message: FEE_LINK_ERRORS[check] }],
        });
      }
      feeChannelId = parsed.link.channelId;
    }
    const updated = await withTransaction(deps.db, async (trx) => {
      const current = await readSettingsRow(trx, true);
      assertVersion(current.version, expectedVersion);
      const plan = planSettingsUpdate(current, body, feeChannelId);
      if (plan.isNoOp) return current;
      const row = await updateSettingsRow(trx, plan.set, auth.user.id, deps.clock.now());
      await audit(trx, auditContext(request), {
        action: "settings.teams_updated",
        entityType: "teams_settings",
        entityId: "singleton",
        changes: plan.changes,
      });
      return row;
    });
    const read = await readSettings(deps.db);
    setEtag(reply, updated.version);
    return toTeamsSettings({ ...read, row: updated, tenantId });
  });

  defineRoute(app, "checkTeamsConnection", async ({ auth, request }) => {
    if (!enabled()) throw new NotFoundError();
    requireCapability(auth, "teams.settings.manage");
    assertMfaForAdmin(auth, deps.config);
    const operation = await withTransaction(deps.db, async (trx) => {
      // Serialise on the settings row so two clicks cannot queue two checks.
      await readSettingsRow(trx, true);
      if (await findActiveCheck(trx)) throw new ConflictError({ detail: "A check is already running." });
      const op = await queueCheck(trx, auth.user.id);
      await audit(trx, auditContext(request), {
        action: "settings.teams_check_started",
        entityType: "teams_settings",
        entityId: "singleton",
      });
      return op;
    });
    return { operationId: operation.id };
  });
}
