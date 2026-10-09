"use client";
import type { JobCard } from "@kr/contracts";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import styles from "./Admin.module.css";

export interface AuditFilterValues {
  readonly job: string;
  readonly actorId: string;
  readonly action: string;
}

export interface AuditFiltersProps {
  readonly values: AuditFilterValues;
  readonly onChange: (change: Partial<AuditFilterValues>) => void;
  readonly jobOptions: readonly JobCard[];
  /** What was typed in "Job" names no job yet. */
  readonly jobUnresolved: boolean;
  readonly actors: readonly { readonly id: string; readonly name: string }[];
}

/** Filters of the audit trail (§9.2): job, user and action. */
export function AuditFilters({ values, onChange, jobOptions, jobUnresolved, actors }: AuditFiltersProps) {
  return (
    <div className={styles.filters}>
      <Field label="Job" {...(jobUnresolved ? { error: "Choose a job number from the list." } : {})}>
        {(control) => (
          <>
            <Input
              {...control}
              list="audit-jobs"
              placeholder="Job number"
              value={values.job}
              onChange={(event) => {
                onChange({ job: event.target.value });
              }}
            />
            <datalist id="audit-jobs">
              {jobOptions.map((job) => (
                <option key={job.id} value={job.jobNumber}>
                  {job.address}
                </option>
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label="User">
        {(control) => (
          <Select
            {...control}
            value={values.actorId}
            onChange={(event) => {
              onChange({ actorId: event.target.value });
            }}
          >
            <option value="">All users</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Action" hint="Starts with, e.g. checkpoint.">
        {(control) => (
          <Input
            {...control}
            value={values.action}
            maxLength={80}
            onChange={(event) => {
              onChange({ action: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}
