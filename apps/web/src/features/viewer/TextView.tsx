"use client";
import type { FileMeta } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/Spinner";
import { fetchFileText, queryKeys } from "@/lib/api";
import { formatPerthDateTime } from "@/features/admin/format";
import { VIEWER_MESSAGES } from "./messages";
import styles from "./ViewerBody.module.css";

export interface TextViewProps {
  readonly file: FileMeta;
  /** false: only the email header block is shown (an Outlook .msg has no text to read in the browser). */
  readonly body?: boolean;
}

type EmailMeta = NonNullable<FileMeta["email"]>;

/** The labelled lines of an email, from the parsed metadata: only those the message has. */
function headerLines(email: EmailMeta): readonly (readonly [string, string])[] {
  const lines: [string, string | null][] = [
    ["Subject", email.subject],
    ["From", email.from],
    ["To", email.to],
    ["Cc", email.cc],
    ["Sent", email.sentAt ? formatPerthDateTime(email.sentAt) : null],
  ];
  return lines.filter((line): line is [string, string] => line[1] !== null && line[1] !== "");
}

function EmailHeaders({ email }: { readonly email: EmailMeta }) {
  const lines = headerLines(email);
  if (lines.length === 0) return null;
  return (
    <dl className={styles.headers}>
      {lines.map(([label, value]) => (
        <div key={label} className={styles.line}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Text, CSV, Markdown and email in a `<pre>` (§11.1); an email also gets its header block above the text. */
export function TextView({ file, body = true }: TextViewProps) {
  const text = useQuery({
    queryKey: queryKeys.files.text(file.id),
    queryFn: ({ signal }) => fetchFileText(file.id, signal),
    enabled: body,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  let content;
  if (!body) content = <p className={styles.notice}>{VIEWER_MESSAGES.emailBody}</p>;
  else if (text.isError) content = <p className={`${styles.notice} ${styles.error}`}>{VIEWER_MESSAGES.loadFailed}</p>;
  else if (text.data === undefined) content = <Spinner label={VIEWER_MESSAGES.loading} />;
  else content = <pre className={styles.text}>{text.data}</pre>;

  if (!file.email) return <div className={styles.mail}>{content}</div>;
  return (
    <div className={styles.mail}>
      <EmailHeaders email={file.email} />
      {content}
    </div>
  );
}
