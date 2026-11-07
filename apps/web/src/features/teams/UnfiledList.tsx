"use client";
import type { TeamsUnfiledItem } from "@kr/contracts";
import { CHECKPOINTS, slotsOf } from "@kr/workflow";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { api, queryKeys } from "@/lib/api";
import { formatMegabytes } from "@/lib/format";
import { useToast } from "@/lib/toast/ToastProvider";
import { TEAMS_MESSAGES as M } from "./messages";
import styles from "./TeamsPanel.module.css";

export interface UnfiledListProps {
  readonly jobId: string;
  readonly canFile: boolean;
  /** Current conditions of the job, for the evidence choices. */
  readonly conditions: readonly { id: string; number: number }[];
}

/** The `<select>` choices: every checkpoint slot staff may upload to, then "Condition N evidence". */
export function filingChoices(
  conditions: readonly { id: string; number: number }[],
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const c of CHECKPOINTS) {
    if (c.restricted === "fee_proposal") continue;
    for (const s of slotsOf(c))
      out.push({ value: `cp:${c.key}:${s.key}`, label: `${c.number} ${c.title} – ${s.title}` });
  }
  for (const c of conditions) out.push({ value: `cond:${c.id}`, label: `Condition ${c.number} evidence` });
  return out;
}

export function problemText(item: TeamsUnfiledItem, uploadMaxBytes: number): string | null {
  if (item.problem === "too_large") return `Too large (limit ${formatMegabytes(uploadMaxBytes)} MB)`;
  if (item.problem === "kind_not_accepted") return "File type not accepted";
  if (item.problem === "malware") return "Blocked: malware found in a file added in Teams";
  return null;
}

/** "Files added in Teams that need filing" (§5.10, phase 2). Hidden when empty. */
export function UnfiledList({ jobId, canFile, conditions }: UnfiledListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useQuery({
    queryKey: queryKeys.teamsUnfiled(jobId),
    queryFn: ({ signal }) => api("listTeamsUnfiled", { params: { jobId }, signal }),
    refetchInterval: 15_000,
  });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.teamsUnfiled(jobId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.teamsLink(jobId) });
  };
  const file = useMutation({
    mutationFn: ({ itemId, value }: { itemId: string; value: string }) => {
      const [kind, a, b] = value.split(":");
      const body = kind === "cond" ? { conditionId: a ?? "" } : { checkpointKey: a ?? "", slot: b ?? "" };
      return api("fileTeamsUnfiled", { params: { jobId, itemId }, body });
    },
    onSuccess: async () => {
      toast("Filing the file. It appears on the job once its virus scan passes.");
      await refresh();
    },
    onError: () => {
      toast("The file could not be filed. Try again.");
    },
  });
  const dismiss = useMutation({
    mutationFn: (itemId: string) => api("dismissTeamsUnfiled", { params: { jobId, itemId } }),
    onSuccess: refresh,
    onError: () => {
      toast("The file could not be dismissed. Try again.");
    },
  });
  if (!list.isSuccess || list.data.items.length === 0) return null;
  const choices = filingChoices(conditions);
  return (
    <section className={styles.unfiled} aria-labelledby="teams-unfiled-title">
      <h3 id="teams-unfiled-title" className={styles.unfiledTitle}>
        {M.unfiledTitle(list.data.items.length)}
      </h3>
      <ul className={styles.unfiledList}>
        {list.data.items.map((item) => {
          const problem = problemText(item, list.data.uploadMaxBytes);
          const selected = choice[item.itemId] ?? "";
          return (
            <li key={item.itemId} className={styles.unfiledRow}>
              <span className={styles.unfiledName}>
                {item.path ? `${item.path}/` : ""}
                {item.name}
              </span>
              <span className={styles.status}>
                {item.sizeBytes !== null ? `${formatMegabytes(item.sizeBytes)} MB` : ""}
                {item.addedBy ? ` · added by ${item.addedBy}` : ""}
              </span>
              {problem ? (
                <span className={styles.attention}>{problem}</span>
              ) : (
                canFile && (
                  <>
                    <Select
                      aria-label={`File ${item.name} into`}
                      value={selected}
                      onChange={(event) => {
                        setChoice((c) => ({ ...c, [item.itemId]: event.target.value }));
                      }}
                    >
                      <option value="">Choose where it belongs</option>
                      {choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      small
                      variant="primary"
                      disabled={!selected || file.isPending}
                      onClick={() => {
                        file.mutate({ itemId: item.itemId, value: selected });
                      }}
                    >
                      File
                    </Button>
                  </>
                )
              )}
              {canFile && (
                <Button
                  small
                  disabled={dismiss.isPending}
                  onClick={() => {
                    dismiss.mutate(item.itemId);
                  }}
                >
                  Dismiss
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
