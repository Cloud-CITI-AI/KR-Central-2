"use client";
import type { JobDetail } from "@kr/contracts";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ArchiveJobDialog } from "./ArchiveJobDialog";

// The dialog validates with the contract's schema (Zod): loaded when EDIT JOB is first used, not with the tracker (FE-9).
const JobDetailsDialog = dynamic(() => import("./JobDetailsDialog").then((module) => module.JobDetailsDialog));

export interface EditJobProps {
  readonly job: JobDetail;
}

/** EDIT JOB (`job.edit`, §5.1) and, with `job.delete`, the archive link and confirmation inside its dialog. */
export function EditJob({ job }: EditJobProps) {
  const [details, setDetails] = useState(false);
  // Mounted at the first EDIT JOB and kept, so closing returns focus to the button as the Dialog does.
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const canArchive = job.capabilities.includes("job.delete");
  return (
    <>
      <Button
        onClick={() => {
          setDetails(true);
          setDetailsLoaded(true);
        }}
      >
        EDIT JOB
      </Button>
      {detailsLoaded && (
        <JobDetailsDialog
          job={job}
          open={details}
          onClose={() => {
            setDetails(false);
          }}
          {...(canArchive
            ? {
                onArchive: () => {
                  setArchiving(true);
                },
              }
            : {})}
        />
      )}
      {canArchive && (
        <ArchiveJobDialog
          job={job}
          open={archiving}
          onClose={() => {
            setArchiving(false);
          }}
        />
      )}
    </>
  );
}
