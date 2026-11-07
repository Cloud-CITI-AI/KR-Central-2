"use client";
import type { TeamsSettings, UpdateTeamsSettingsRequest } from "@kr/contracts";
import { hasCapability } from "@kr/contracts/capabilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useOperation } from "@/lib/query/hooks";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast/ToastProvider";
import styles from "./Admin.module.css";
import { ProblemNotice } from "./ProblemNotice";
import teams from "./TeamsSettings.module.css";

/** The §9.3 label of each Test connection check, in the order the worker runs them. */
export const CHECK_LABELS: Readonly<Record<string, string>> = {
  token: "Signed in to Microsoft",
  team_site: "Team site found",
  team_site_write: "Can write to the team site",
  fee_site: "Fee Proposals site found",
  fee_site_write: "Can write to the Fee Proposals site",
  channel_list: "Can list channels",
  channel_create: "Can create channels",
};

export const TEXTS = {
  saved: "Settings saved.",
  teamChanged: "Jobs already linked keep their current channel. Relink them to move them.",
  syncOff: "Copying stops now. Files already in Teams stay there.",
} as const;

type Form = UpdateTeamsSettingsRequest;

/** The form as the stored settings fill it (the fee channel link is the rebuilt one). */
export function formFrom(s: TeamsSettings): Form {
  return {
    teamId: s.teamId,
    teamSiteUrl: s.teamSiteUrl,
    feeChannelLink: s.feeChannelLink,
    feeSiteUrl: s.feeSiteUrl,
    rootFolder: s.rootFolder,
    feeProposalPolicy: s.feeProposalPolicy,
    syncEnabled: s.syncEnabled,
    inboundSyncEnabled: s.inboundSyncEnabled,
    createChannelsEnabled: s.createChannelsEnabled,
    inboundPollSeconds: s.inboundPollSeconds,
  };
}

/** What to tell the person after a save, given what changed (§9.3 texts). */
export function saveNotes(before: TeamsSettings, after: TeamsSettings): string[] {
  const notes: string[] = [TEXTS.saved];
  if (before.teamId !== after.teamId && before.teamId !== null) notes.push(TEXTS.teamChanged);
  if (before.syncEnabled && !after.syncEnabled) notes.push(TEXTS.syncOff);
  return notes;
}

const blank = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/** `/admin/teams` (§9.3): the one settings row, If-Match on save, and Test connection polled through getOperation. */
export function TeamsSettingsPage() {
  const settings = useQuery({
    queryKey: queryKeys.teamsSettings,
    queryFn: ({ signal }) => api("getTeamsSettings", { signal }),
  });
  if (settings.isPending) return <Spinner label="Loading Teams settings…" />;
  if (settings.isError) {
    return (
      <ProblemNotice
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      />
    );
  }
  // The form is keyed by the stored version: a save or a stale reload gives it fresh initial values.
  return <SettingsForm key={settings.data.version} stored={settings.data} />;
}

function SettingsForm({ stored }: { readonly stored: TeamsSettings }) {
  const me = useSession();
  const canManage = hasCapability(me.capabilities, "teams.settings.manage");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => formFrom(stored));
  const [problem, setProblem] = useState<unknown>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const check = useOperation(checkId ?? stored.lastCheck?.operationId);

  const save = useMutation({
    mutationFn: (body: Form) => api("updateTeamsSettings", { body, ifMatch: stored.version }),
    onMutate: () => {
      setProblem(null);
    },
    onSuccess: (saved) => {
      for (const note of saveNotes(stored, saved)) toast(note);
      queryClient.setQueryData(queryKeys.teamsSettings, saved);
    },
    onError: (error) => {
      setProblem(error);
    },
    onSettled: async (_d, error) => {
      if (error instanceof ApiProblem && error.isStale) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.teamsSettings });
      }
    },
  });

  const test = useMutation({
    mutationFn: () => api("checkTeamsConnection"),
    onMutate: () => {
      setProblem(null);
    },
    onSuccess: ({ operationId }) => {
      setCheckId(operationId);
    },
    onError: (error) => {
      setProblem(error);
    },
  });

  const fieldError = (path: string): string | undefined =>
    problem instanceof ApiProblem ? problem.errors.find((e) => e.path === path)?.message : undefined;
  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };
  const busy = save.isPending || !canManage;
  const checkRunning = check.data?.status === "queued" || check.data?.status === "running";
  const results =
    check.data?.status === "succeeded" && check.data.result && "results" in check.data.result
      ? check.data.result
      : null;

  return (
    <section className={styles.panel} aria-label="Teams settings">
      {!canManage && (
        <p className={styles.summary} role="status">
          You can see these settings but only an admin can change them.
        </p>
      )}
      {problem !== null && <ProblemNotice error={problem} />}
      <form
        className={teams.form}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <fieldset className={teams.group} disabled={busy}>
          <legend>Team</legend>
          <Field
            label="Team id"
            hint="The Microsoft 365 group id of the team (KR IT has it)"
            error={fieldError("teamId")}
          >
            {(c) => (
              <Input
                {...c}
                value={form.teamId ?? ""}
                onChange={(e) => {
                  update("teamId", blank(e.target.value));
                }}
              />
            )}
          </Field>
          <Field
            label="Team site URL"
            hint="https://{tenant}.sharepoint.com/sites/{name}"
            error={fieldError("teamSiteUrl")}
          >
            {(c) => (
              <Input
                {...c}
                type="url"
                value={form.teamSiteUrl ?? ""}
                onChange={(e) => {
                  update("teamSiteUrl", blank(e.target.value));
                }}
              />
            )}
          </Field>
          <Field label="Team name" hint="Filled by Test connection when Microsoft allows it">
            {(c) => <Input {...c} value={stored.teamName ?? ""} readOnly />}
          </Field>
          <Field label="Root folder" hint="The channel folder the tracker copies into" error={fieldError("rootFolder")}>
            {(c) => (
              <Input
                {...c}
                value={form.rootFolder}
                onChange={(e) => {
                  update("rootFolder", e.target.value);
                }}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={teams.group} disabled={busy}>
          <legend>Fee proposals</legend>
          <Field label="Fee proposal policy" error={fieldError("feeProposalPolicy")}>
            {(c) => (
              <Select
                {...c}
                value={form.feeProposalPolicy}
                onChange={(e) => {
                  update("feeProposalPolicy", e.target.value as Form["feeProposalPolicy"]);
                }}
              >
                <option value="exclude">Do not copy fee proposals</option>
                <option value="restricted">Copy to the private Fee Proposals channel</option>
              </Select>
            )}
          </Field>
          <Field
            label="Fee Proposals channel link"
            hint="In Teams, open the channel, choose Get link to channel, and paste it here."
            error={fieldError("feeChannelLink")}
          >
            {(c) => (
              <Input
                {...c}
                value={form.feeChannelLink ?? ""}
                onChange={(e) => {
                  update("feeChannelLink", blank(e.target.value));
                }}
              />
            )}
          </Field>
          <Field label="Fee Proposals site URL" error={fieldError("feeSiteUrl")}>
            {(c) => (
              <Input
                {...c}
                type="url"
                value={form.feeSiteUrl ?? ""}
                onChange={(e) => {
                  update("feeSiteUrl", blank(e.target.value));
                }}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={teams.group} disabled={busy}>
          <legend>Switches</legend>
          <label className={teams.switch}>
            <input
              type="checkbox"
              checked={form.syncEnabled}
              onChange={(e) => {
                update("syncEnabled", e.target.checked);
              }}
            />
            Copy files to Teams
          </label>
          {fieldError("syncEnabled") && (
            <p className={teams.error} role="alert">
              {fieldError("syncEnabled")}
            </p>
          )}
          <label className={teams.switch}>
            <input
              type="checkbox"
              checked={form.inboundSyncEnabled}
              disabled={!form.syncEnabled}
              onChange={(e) => {
                update("inboundSyncEnabled", e.target.checked);
              }}
            />
            Bring files added in Teams into the tracker
          </label>
          <label className={teams.switch}>
            <input
              type="checkbox"
              checked={form.createChannelsEnabled}
              disabled={!form.inboundSyncEnabled}
              onChange={(e) => {
                update("createChannelsEnabled", e.target.checked);
              }}
            />
            Create channels for new jobs
          </label>
          <Field label="Check Teams every (minutes)" error={fieldError("inboundPollSeconds")}>
            {(c) => (
              <Input
                {...c}
                type="number"
                min={1}
                max={1440}
                value={Math.round(form.inboundPollSeconds / 60)}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  update("inboundPollSeconds", (Number.isFinite(minutes) && minutes >= 1 ? minutes : 1) * 60);
                }}
              />
            )}
          </Field>
        </fieldset>

        <div className={teams.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            disabled={!canManage || test.isPending || checkRunning}
            onClick={() => {
              test.mutate();
            }}
          >
            Test connection
          </Button>
          <span className={styles.summary}>
            Last saved {new Date(stored.updatedAt).toLocaleString()}
            {stored.updatedBy ? ` by ${stored.updatedBy.displayName}` : ""}
          </span>
        </div>
      </form>

      {(checkRunning || results !== null || check.data?.status === "failed") && (
        <section className={teams.results} aria-label="Test connection results" aria-live="polite">
          <h3 className={teams.resultsTitle}>Test connection</h3>
          {checkRunning && <Spinner label="Checking the connection to Microsoft Teams…" />}
          {check.data?.status === "failed" && (
            <p className={teams.error} role="alert">
              {check.data.error?.message ?? "The check could not run."}
            </p>
          )}
          {results && (
            <ul className={teams.checkList}>
              {results.results.map((r) => (
                <li key={r.item} className={r.ok ? teams.pass : teams.fail}>
                  <span aria-hidden="true">{r.ok ? "✓" : "✗"}</span> {CHECK_LABELS[r.item] ?? r.item}
                  {r.errorCode ? <code className={teams.code}>{r.errorCode}</code> : null}
                  <span className={teams.visuallyHidden}>{r.ok ? " passed" : " failed"}</span>
                </li>
              ))}
              {results.skipped.map((item) => (
                <li key={item} className={teams.skipped}>
                  <span aria-hidden="true">–</span> {CHECK_LABELS[item] ?? item}
                  <span className={teams.visuallyHidden}> not checked</span>
                </li>
              ))}
            </ul>
          )}
          {check.data?.completedAt && (
            <p className={styles.summary}>Ran {new Date(check.data.completedAt).toLocaleString()}</p>
          )}
        </section>
      )}
    </section>
  );
}
