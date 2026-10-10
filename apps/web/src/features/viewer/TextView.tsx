"use client";
import type { FileMeta } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/Spinner";
import { fetchFileText, queryKeys } from "@/lib/api";
import { VIEWER_MESSAGES } from "./messages";
import styles from "./ViewerBody.module.css";

export interface TextViewProps {
  readonly file: FileMeta;
}

/** The file's own bytes as text in a `<pre>`, fetched through the BFF. */
export function RawText({ file }: TextViewProps) {
  const text = useQuery({
    queryKey: queryKeys.files.text(file.id),
    queryFn: ({ signal }) => fetchFileText(file.id, signal),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (text.isError) return <p className={`${styles.notice} ${styles.error}`}>{VIEWER_MESSAGES.loadFailed}</p>;
  if (text.data === undefined) return <Spinner label={VIEWER_MESSAGES.loading} />;
  return <pre className={styles.text}>{text.data}</pre>;
}

/** Text, CSV and Markdown in a `<pre>` (§11.1). Emails have their own view (`EmailView`). */
export function TextView({ file }: TextViewProps) {
  return (
    <div className={styles.mail}>
      <RawText file={file} />
    </div>
  );
}
