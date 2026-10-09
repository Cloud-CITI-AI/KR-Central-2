"use client";
import { buildPath, getRoute, type JobDetail } from "@kr/contracts";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { API_BASE } from "@/lib/api/client";
import { countText, FILES_MESSAGES } from "./messages";
import styles from "./JobFiles.module.css";

export interface JobFilesProps {
  readonly job: JobDetail;
}

/**
 * "JOB FILES" (§5.8), placed by the tracker after the notes: the count of files the viewer can download and
 * DOWNLOAD ALL FILES (.ZIP). The button is a plain link to the BFF, which streams the zip from the API: the browser
 * saves it as it arrives and the page never holds it in memory. With no files it is a disabled button.
 */
export function JobFiles({ job }: JobFilesProps) {
  const count = job.summary.fileCount;
  const href = `${API_BASE}${buildPath(getRoute("downloadJobPackage").path, { jobId: job.id })}`;
  return (
    <section className={styles.box} aria-labelledby="job-files-title">
      <div className={styles.head}>
        <h2 id="job-files-title" className={styles.title}>
          {FILES_MESSAGES.title}
        </h2>
        <p className={styles.text}>{count > 0 ? countText(count) : FILES_MESSAGES.none}</p>
      </div>
      {job.capabilities.includes("package.download") &&
        (count > 0 ? (
          <ButtonLink href={href} variant="primary">
            {FILES_MESSAGES.download}
          </ButtonLink>
        ) : (
          <Button variant="primary" disabled>
            {FILES_MESSAGES.download}
          </Button>
        ))}
    </section>
  );
}
