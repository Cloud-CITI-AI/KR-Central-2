"use client";
import type { FileMeta } from "@kr/contracts";
import { formatPerthDateTime } from "@/features/admin/format";
import { OUTLOOK_MSG } from "./content";
import { VIEWER_MESSAGES } from "./messages";
import { RawText } from "./TextView";
import styles from "./ViewerBody.module.css";

export interface EmailViewProps {
  readonly file: FileMeta;
}

type EmailMeta = NonNullable<FileMeta["email"]>;

/** The labelled lines of an email, from the parsed metadata: only those the message has (the prototype's `emailText`). */
function headerLines(email: EmailMeta): readonly (readonly [string, string])[] {
  const lines: [string, string | null][] = [
    ["Subject", email.subject],
    ["From", email.from],
    ["To", email.to],
    ["Cc", email.cc],
    ["Date", email.sentAt ? formatPerthDateTime(email.sentAt) : null],
  ];
  return lines.filter((line): line is [string, string] => line[1] !== null && line[1] !== "");
}

function Body({ file }: EmailViewProps) {
  const email = file.email;
  if (email?.bodyText) return <pre className={styles.text}>{email.bodyText}</pre>;
  if (email?.parseStatus === "parsed") return <p className={styles.notice}>{VIEWER_MESSAGES.noMessageText}</p>;
  // Not parsed (yet): an Outlook .msg has no text to show, anything else is text and can be read as it is stored.
  if (file.contentType === OUTLOOK_MSG) return <p className={styles.notice}>{VIEWER_MESSAGES.emailBody}</p>;
  return <RawText file={file} />;
}

/**
 * An email as the prototype renders it (§10.3): Subject/From/To/Cc/Date, a rule, then the parsed message text. The text comes
 * with the file's metadata (the parser's output), so it is the same for .eml, Outlook .msg and pasted emails.
 */
export function EmailView({ file }: EmailViewProps) {
  const lines = file.email ? headerLines(file.email) : [];
  return (
    <div className={styles.mail}>
      {lines.length > 0 && (
        <dl className={styles.headers}>
          {lines.map(([label, value]) => (
            <div key={label} className={styles.line}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <hr className={styles.rule} />
      <Body file={file} />
    </div>
  );
}
