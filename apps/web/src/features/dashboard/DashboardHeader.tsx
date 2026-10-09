"use client";
import { SUBDIVISION_TYPES } from "@kr/workflow";
import { useEffect, useState, type ReactNode } from "react";
import type { DashboardParams } from "./params";
import type { DashboardStatus, Facets } from "./types";
import styles from "./DashboardHeader.module.css";

export interface DashboardHeaderProps {
  readonly params: DashboardParams;
  /** Undefined while the counts load: the controls render without numbers. */
  readonly facets: Facets | undefined;
  readonly onChange: (patch: Partial<DashboardParams>) => void;
  /** Extra buttons beside the search box (NEW JOB). */
  readonly actions?: ReactNode;
  /** Full-width content under the type chips (the inline new-job form). */
  readonly children?: ReactNode;
}

const STATUS_BUTTONS = [
  ["in_progress", "In progress"],
  ["complete", "Complete"],
  ["all", "All"],
] as const satisfies readonly (readonly [DashboardStatus, string])[];

const SEARCH_DELAY_MS = 250;

/** "SUBDIVISION DASHBOARD" box (§6): status filter, search, and the type chips. Every choice lives in the URL. */
export function DashboardHeader({ params, facets, onChange, actions, children }: DashboardHeaderProps) {
  // The box keeps what is typed; the URL follows after a pause, and back/forward put the URL's text back.
  const [text, setText] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== text.trim()) setText(params.q);
  }
  useEffect(() => {
    if (text.trim() === params.q) return;
    const timer = setTimeout(() => {
      onChange({ q: text });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, params.q, onChange]);
  const typeCount = (key: string) => facets?.typeCounts[key] ?? 0;

  return (
    <section className={styles.head} aria-labelledby="dash-title">
      <h2 id="dash-title" className={styles.title}>
        Subdivision dashboard
      </h2>
      <div className={styles.tools}>
        <div className={styles.filter} role="group" aria-label="Show">
          {STATUS_BUTTONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={params.status === value}
              onClick={() => {
                onChange({ status: value });
              }}
            >
              {facets ? `${label} (${facets.statusCounts[value]})` : label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className={styles.search}
          aria-label="Search jobs"
          placeholder="Search job, address or client"
          autoComplete="off"
          maxLength={100}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        {actions}
      </div>
      <div className={styles.types} role="group" aria-label="Subdivision type">
        <span className={styles.typeLabel} aria-hidden="true">
          Type
        </span>
        {[["", "All types"] as const, ...SUBDIVISION_TYPES.map((type) => [type, type] as const)].map(
          ([value, label]) => (
            <button
              key={value}
              type="button"
              className={styles.chip}
              aria-pressed={params.type === value}
              onClick={() => {
                onChange({ type: params.type === value ? "" : value });
              }}
            >
              {label}
              <span className={styles.chipCount}>{facets ? typeCount(value) : ""}</span>
            </button>
          ),
        )}
      </div>
      {children}
    </section>
  );
}
