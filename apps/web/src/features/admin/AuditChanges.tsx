import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import styles from "./AdminTable.module.css";

/** Longest value shown in full; the rest is cut with an ellipsis (the full text stays in the title). */
const MAX_LENGTH = 160;

function show(value: unknown): { text: string; empty: boolean } {
  if (value === null || value === undefined || value === "") return { text: "empty", empty: true };
  return { text: typeof value === "string" ? value : JSON.stringify(value), empty: false };
}

function Value({ value }: { readonly value: unknown }) {
  const { text, empty } = show(value);
  const cut = text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
  return (
    <span className={empty ? styles.empty : styles.value} title={cut === text ? undefined : text}>
      {cut}
    </span>
  );
}

export interface AuditChangesProps {
  readonly changes: Readonly<Record<string, { readonly from?: unknown; readonly to?: unknown }>> | null;
}

/** "field: from → to" for each changed field (§9.2); events without changes show a dash. */
export function AuditChanges({ changes }: AuditChangesProps) {
  const entries = Object.entries(changes ?? {});
  if (entries.length === 0) return <span className={styles.empty}>–</span>;
  return (
    <ul className={styles.changes}>
      {entries.map(([field, { from, to }]) => (
        <li key={field}>
          <span className={styles.field}>{field}</span>: <Value value={from} /> <span aria-hidden="true">→</span>
          <VisuallyHidden> changed to </VisuallyHidden> <Value value={to} />
        </li>
      ))}
    </ul>
  );
}
