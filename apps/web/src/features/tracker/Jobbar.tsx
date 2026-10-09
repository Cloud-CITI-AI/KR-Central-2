"use client";
import type { JobDetail } from "@kr/contracts";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { JobPicker } from "./JobPicker";
import { TRACKER_MESSAGES } from "./messages";
import styles from "./Jobbar.module.css";

export interface JobbarProps {
  readonly job: JobDetail;
  /** Expands every stage, opens the print dialog and restores the stages afterwards (§5.1). */
  readonly onSaveAsPdf: () => void;
}

/** The jobbar (§5.1): job picker, DASHBOARD and Save as PDF. Buttons are hidden when printing. */
export function Jobbar({ job, onSaveAsPdf }: JobbarProps) {
  return (
    <div className={styles.jobbar}>
      <JobPicker job={job} />
      <ButtonLink href="/" variant="primary">
        Dashboard
      </ButtonLink>
      <Button title={TRACKER_MESSAGES.saveAsPdfTitle} onClick={onSaveAsPdf}>
        Save as PDF
      </Button>
    </div>
  );
}
