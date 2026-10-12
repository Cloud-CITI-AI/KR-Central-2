"use client";
import { CreateAccessGrantRequest } from "@kr/contracts";
import { jobDisplayText } from "@kr/workflow";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type SubmitEvent } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import { saveFailedMessage } from "@/lib/messages";
import { ACCESS_MESSAGES, ROLE_OPTIONS, addedText, duplicateText, saveFailedText } from "./messages";
import { useJobChoices } from "./queries";
import styles from "./AccessForm.module.css";

type GrantBody = z.output<typeof CreateAccessGrantRequest>;
type Notice = { readonly kind: "ok" | "error"; readonly text: string } | null;

/** The grant form (it loads the job picker itself): email, optional name, role, job (grouped In progress / Complete) and GRANT ACCESS (§6). */
export function AccessForm() {
  const { choices: jobs } = useJobChoices();
  const { features } = useSession();
  const queryClient = useQueryClient();
  const emailInput = useRef<HTMLInputElement>(null);
  const jobSelect = useRef<HTMLSelectElement>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<GrantBody["role"]>("client");
  const [jobId, setJobId] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const jobNumberOf = (id: string) => jobs.find((job) => job.id === id)?.jobNumber ?? "that job";

  const grant = useMutation({
    mutationFn: (body: GrantBody) => api("createAccessGrant", { body, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (created) => {
      setNotice({
        kind: "ok",
        text: addedText(created.email, features.guestInvites && created.invitationStatus === "sent"),
      });
      setEmail("");
      setName("");
      emailInput.current?.focus();
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants() });
    },
    onError: (problem, body) => {
      const duplicate = problem instanceof ApiProblem && problem.status === 409;
      setNotice({
        kind: "error",
        text: duplicate
          ? duplicateText(body.email, jobNumberOf(body.jobId))
          : saveFailedMessage(problem, saveFailedText),
      });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emailCheck = CreateAccessGrantRequest.shape.email.safeParse(email);
    if (!emailCheck.success) {
      setNotice({ kind: "error", text: emailCheck.error.issues[0]?.message ?? "" });
      emailInput.current?.focus();
      return;
    }
    if (!jobId) {
      setNotice({ kind: "error", text: ACCESS_MESSAGES.noJob });
      jobSelect.current?.focus();
      return;
    }
    const parsed = CreateAccessGrantRequest.safeParse({
      email,
      role,
      jobId,
      ...(name.trim() ? { displayName: name.trim() } : {}),
    });
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues[0]?.message ?? "" });
      return;
    }
    setNotice(null);
    grant.mutate(parsed.data);
  };

  const groups = [
    ["In progress", jobs.filter((job) => !job.isComplete)],
    ["Complete", jobs.filter((job) => job.isComplete)],
  ] as const;
  return (
    <>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Input
          ref={emailInput}
          type="email"
          aria-label="Email address"
          placeholder="name@example.com"
          autoComplete="off"
          maxLength={254}
          value={email}
          className={styles.input}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Input
          type="text"
          aria-label="Name"
          placeholder="Name (optional)"
          autoComplete="off"
          maxLength={120}
          value={name}
          className={styles.input}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Select
          aria-label="Role"
          value={role}
          className={styles.select}
          onChange={(event) => {
            setRole(event.target.value === "architect" ? "architect" : "client");
          }}
        >
          {ROLE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          ref={jobSelect}
          aria-label="Job"
          value={jobId}
          className={styles.job}
          onChange={(event) => {
            setJobId(event.target.value);
          }}
        >
          <option value="">Choose a job…</option>
          {groups
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <optgroup key={label} label={label}>
                {list.map((job) => (
                  <option key={job.id} value={job.id}>
                    {jobDisplayText(job)}
                  </option>
                ))}
              </optgroup>
            ))}
        </Select>
        <Button type="submit" variant="primary" disabled={grant.isPending}>
          Grant access
        </Button>
      </form>
      <span className={styles.scope}>{ACCESS_MESSAGES.scope}</span>
      <div aria-live="polite">
        {notice && (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={notice.kind === "error" ? styles.error : styles.ok}
          >
            {notice.text}
          </p>
        )}
      </div>
    </>
  );
}
