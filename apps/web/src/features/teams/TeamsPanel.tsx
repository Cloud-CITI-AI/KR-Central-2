"use client";
import type { JobCapability, TeamsLink } from "@kr/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { formatPerthDateTime } from "@/features/admin/format";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast/ToastProvider";
import { errorReason, looksLikeChannelLink, TEAMS_MESSAGES as M } from "./messages";
import styles from "./TeamsPanel.module.css";
import { UnfiledList } from "./UnfiledList";

export interface TeamsPanelProps {
  readonly jobId: string;
  readonly capabilities: readonly JobCapability[];
  /** The job's current conditions, for the Unfiled list's evidence choices (phase 2). */
  readonly conditions?: readonly { id: string; number: number }[];
}

/** Query of the job's link; polled every 15 s while folders are being set up (the page's own refresh cadence). */
export function useTeamsLink(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.teamsLink(jobId),
    queryFn: ({ signal }) => api("getJobTeamsLink", { params: { jobId }, signal }),
    enabled,
    retry: (count, error) => !(error instanceof ApiProblem && error.status === 404) && count < 2,
    refetchInterval: (query) => (query.state.data?.state === "provisioning" ? 15_000 : false),
  });
}

/**
 * "TEAMS CHANNEL" (§5.10): hidden for anyone without `teams.view`, when the integration is off (the API answers 404)
 * or while loading. Admins and KR admins link, relink and unlink; staff see the state only.
 */
export function TeamsPanel({ jobId, capabilities, conditions = [] }: TeamsPanelProps) {
  const me = useSession();
  const enabled = me.features.teamsFileSync && capabilities.includes("teams.view");
  const link = useTeamsLink(jobId, enabled);
  if (!enabled || link.isPending || link.isError) return null;
  return (
    <TeamsPanelBody
      jobId={jobId}
      link={link.data}
      canFile={capabilities.includes("files.upload.staff_slots")}
      conditions={conditions}
    />
  );
}

/** The pasted-link form of a chosen channel; the API validates it like any pasted link. */
export function buildPastedLink(channelId: string, name: string, teamId: string, tenantId: string): string {
  const params = new URLSearchParams({ groupId: teamId, tenantId });
  return `https://teams.microsoft.com/l/channel/${encodeURIComponent(channelId)}/${encodeURIComponent(name)}?${params.toString()}`;
}

function TeamsPanelBody({
  jobId,
  link,
  canFile,
  conditions,
}: {
  readonly jobId: string;
  readonly link: TeamsLink;
  readonly canFile: boolean;
  readonly conditions: readonly { id: string; number: number }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<"link" | "unlink" | null>(null);
  const [channelLink, setChannelLink] = useState("");
  const [pasting, setPasting] = useState(false);
  const [picked, setPicked] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Phase 3: the picker reads the worker's channel cache; the paste field stays as the fallback.
  const channels = useQuery({
    queryKey: queryKeys.teamsChannels,
    queryFn: ({ signal }) => api("listTeamsChannels", { signal }),
    enabled: dialog === "link" && link.canLink,
    retry: false,
  });
  const pickerChannels = channels.data?.channels ?? [];
  const usePicker = pickerChannels.length > 0 && !pasting;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.teamsLink(jobId) });
  const createChannel = useMutation({
    mutationFn: () => api("createJobTeamsChannel", { params: { jobId } }),
    onSuccess: async () => {
      toast("Creating the Teams channel…");
      await refresh();
    },
    onError: (error) => {
      toast(
        error instanceof ApiProblem && error.detail ? error.detail : "The channel could not be created. Try again.",
      );
    },
  });
  const linkChannel = useMutation({
    mutationFn: (text: string) =>
      api("linkJobTeamsChannel", {
        params: { jobId },
        body: { channelLink: text },
        ...(link.version !== null ? { ifMatch: link.version } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.teamsLink(jobId), updated);
      setDialog(null);
      setChannelLink("");
      toast(`Linked to ${updated.channelName ?? "the channel"}. Setting up folders in Teams…`);
    },
    onError: (error) => {
      setProblem(
        error instanceof ApiProblem
          ? (error.errors[0]?.message ?? error.detail ?? "The channel could not be linked.")
          : "The channel could not be linked.",
      );
    },
    onSettled: async (_d, error) => {
      if (error instanceof ApiProblem && error.isStale) await refresh();
    },
  });
  const unlink = useMutation({
    mutationFn: () => api("unlinkJobTeamsChannel", { params: { jobId } }),
    onSuccess: async () => {
      setDialog(null);
      toast("Unlinked from Teams.");
      await refresh();
    },
    onError: () => {
      setDialog(null);
      toast("The channel could not be unlinked. Try again.");
    },
  });

  const submit = () => {
    setProblem(null);
    if (usePicker) {
      const chosen = pickerChannels.find((c) => c.channelId === picked);
      if (!chosen || !channels.data?.teamId) {
        setProblem(M.dialog.pickOne);
        return;
      }
      // the API validates team and tenant; the link carries the id and name of the chosen channel
      linkChannel.mutate(
        buildPastedLink(chosen.channelId, chosen.displayName, channels.data.teamId, channels.data.tenantId),
      );
      return;
    }
    if (!looksLikeChannelLink(channelLink)) {
      setProblem(M.dialog.invalid);
      return;
    }
    linkChannel.mutate(channelLink);
  };

  const linked = link.state === "ready" || link.state === "error" || link.state === "provisioning";
  const canCreate = link.canLink && link.createEnabled && (link.state === "not_linked" || link.state === "not_created");
  return (
    <section className={styles.box} aria-labelledby="teams-panel-title">
      <div className={styles.head}>
        <h2 id="teams-panel-title" className={styles.title}>
          {M.title}
        </h2>
        {link.canLink && link.state !== "sync_off" && (
          <div className={styles.actions}>
            {!linked && (
              <Button
                variant="primary"
                onClick={() => {
                  setProblem(null);
                  setPasting(false);
                  setDialog("link");
                }}
              >
                {M.link}
              </Button>
            )}
            {canCreate && (
              <Button
                disabled={createChannel.isPending}
                onClick={() => {
                  createChannel.mutate();
                }}
              >
                {M.create}
              </Button>
            )}
            {link.state === "error" && (
              <Button
                variant="primary"
                onClick={() => {
                  setProblem(null);
                  setDialog("link");
                }}
              >
                {M.relink}
              </Button>
            )}
            {linked && (
              <Button
                onClick={() => {
                  setDialog("unlink");
                }}
              >
                {M.unlink}
              </Button>
            )}
          </div>
        )}
      </div>

      {link.state === "sync_off" && (
        <p className={styles.status} role="status">
          {M.syncOff}
        </p>
      )}
      {link.state === "not_linked" && <p className={styles.status}>{M.notLinked}</p>}
      {link.state === "not_created" && (
        <p className={styles.attention} role="alert">
          {link.errorCode === "channel_name_taken" ? M.notCreatedTaken : M.notCreated}
        </p>
      )}
      {link.state === "provisioning" && (
        <div className={styles.status} role="status">
          <Spinner label={M.settingUp} />
        </div>
      )}
      {(link.state === "ready" || link.state === "error") && (
        <p className={styles.channel}>
          {link.channelName}
          {link.teamsUrl && (
            <a href={link.teamsUrl} target="_blank" rel="noopener noreferrer">
              {M.openInTeams}
            </a>
          )}
        </p>
      )}
      {link.state === "error" && (
        <p className={styles.attention} role="alert">
          {M.error(errorReason(link.errorCode))}
        </p>
      )}
      {link.state === "ready" && (
        <>
          <p className={styles.status}>{M.counts(link.counts)}</p>
          <p className={styles.status}>
            {link.lastPushAt ? M.lastCopied(formatPerthDateTime(link.lastPushAt)) : M.nothingCopied}
          </p>
        </>
      )}
      {link.state === "ready" && link.inboundSyncEnabled && (
        <UnfiledList jobId={jobId} canFile={canFile} conditions={conditions} />
      )}
      {link.state !== "sync_off" && (
        <p className={styles.note}>
          {M.feeNote}
          {link.feeProposalFolderUrl && (
            <>
              {" "}
              <a href={link.feeProposalFolderUrl} target="_blank" rel="noopener noreferrer">
                {M.feeFolder}
              </a>
            </>
          )}
        </p>
      )}

      <Dialog
        open={dialog === "link"}
        onClose={() => {
          setDialog(null);
        }}
        title={M.dialog.title}
        size="small"
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {usePicker ? (
            <>
              <Field label={M.dialog.picker} error={problem}>
                {(c) => (
                  <Select
                    {...c}
                    data-autofocus
                    value={picked}
                    onChange={(event) => {
                      setPicked(event.target.value);
                    }}
                  >
                    <option value="">Choose a channel</option>
                    {pickerChannels.map((ch) => (
                      <option key={ch.channelId} value={ch.channelId}>
                        {ch.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                type="button"
                small
                onClick={() => {
                  setProblem(null);
                  setPasting(true);
                }}
              >
                {M.dialog.pasteInstead}
              </Button>
            </>
          ) : (
            <Field label={M.dialog.field} hint={M.dialog.hint} error={problem}>
              {(c) => (
                <Input
                  {...c}
                  data-autofocus
                  value={channelLink}
                  onChange={(event) => {
                    setChannelLink(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          <div className={styles.buttons}>
            <Button
              type="button"
              onClick={() => {
                setDialog(null);
              }}
            >
              {M.dialog.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={linkChannel.isPending}>
              {M.dialog.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={dialog === "unlink"}
        title={M.unlinkConfirm.title}
        confirmLabel={M.unlinkConfirm.confirm}
        cancelLabel={M.unlinkConfirm.cancel}
        busy={unlink.isPending}
        onConfirm={() => {
          unlink.mutate();
        }}
        onCancel={() => {
          setDialog(null);
        }}
      >
        {M.unlinkConfirm.text}
      </ConfirmDialog>
    </section>
  );
}
