"use client";
import { CreateJobRequest } from "@kr/contracts";
import { SUBDIVISION_TYPES } from "@kr/workflow";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { saveFailedMessage } from "@/lib/messages";
import { NEW_JOB_MESSAGES, duplicateJobText, saveFailedJobText } from "./messages";
import styles from "./NewJobForm.module.css";

export interface NewJobFormProps {
  readonly onCancel: () => void;
}

type CreateJobBody = z.output<typeof CreateJobRequest>;
type Field = "jobNumber" | "address" | "subdivisionType";

/** The inline NEW JOB form of the dashboard header (§6, prototype `form.newjob`): creates the job, then opens it. */
export function NewJobForm({ onCancel }: NewJobFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");

  const focus = (name: Field) => {
    const control = form.current?.elements.namedItem(name);
    if (control instanceof HTMLElement) control.focus();
  };
  useEffect(() => {
    focus("jobNumber");
  }, []);

  const create = useMutation({
    mutationFn: (body: CreateJobBody) => api("createJob", { body, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push(`/jobs/${job.id}`);
    },
    onError: (problem, body) => {
      if (problem instanceof ApiProblem && problem.status === 409) {
        setError(duplicateJobText(body.jobNumber));
        focus("jobNumber");
      } else setError(saveFailedMessage(problem, saveFailedJobText));
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const required: readonly (readonly [Field, string])[] = [
      ["jobNumber", NEW_JOB_MESSAGES.jobNumber],
      ["address", NEW_JOB_MESSAGES.address],
      ["subdivisionType", NEW_JOB_MESSAGES.subdivisionType],
    ];
    const missing = required.find(([name]) => !text(name));
    if (missing) {
      setError(missing[1]);
      focus(missing[0]);
      return;
    }
    const body = {
      jobNumber: text("jobNumber"),
      address: text("address"),
      subdivisionType: text("subdivisionType"),
      ...(text("clientName") ? { clientName: text("clientName") } : {}),
    };
    const parsed = CreateJobRequest.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? NEW_JOB_MESSAGES.jobNumber);
      focus("jobNumber");
      return;
    }
    setError("");
    create.mutate(parsed.data);
  };

  return (
    <form ref={form} className={styles.form} onSubmit={submit} noValidate>
      <Input
        name="jobNumber"
        aria-label="Job number"
        placeholder="Job number"
        maxLength={32}
        autoComplete="off"
        className={styles.input}
      />
      <Input
        name="address"
        aria-label="Address"
        placeholder="Address"
        maxLength={200}
        autoComplete="off"
        className={styles.input}
      />
      <Input
        name="clientName"
        aria-label="Client (optional)"
        placeholder="Client (optional)"
        maxLength={200}
        autoComplete="off"
        className={styles.input}
      />
      <Select name="subdivisionType" aria-label="Subdivision type" defaultValue="" className={styles.input}>
        <option value="">Subdivision type…</option>
        {SUBDIVISION_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="primary" disabled={create.isPending}>
        Create job
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  );
}
