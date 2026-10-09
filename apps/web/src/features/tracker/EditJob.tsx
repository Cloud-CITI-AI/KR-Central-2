"use client";
import type { JobDetail } from "@kr/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ArchiveJobDialog } from "./ArchiveJobDialog";
import { JobDetailsDialog } from "./JobDetailsDialog";

export interface EditJobProps {
  readonly job: JobDetail;
}

/** EDIT JOB (`job.edit`, §5.1) and, with `job.delete`, the archive link and confirmation inside its dialog. */
export function EditJob({ job }: EditJobProps) {
  const [details, setDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const canArchive = job.capabilities.includes("job.delete");
  return (
    <>
      <Button
        onClick={() => {
          setDetails(true);
        }}
      >
        EDIT JOB
      </Button>
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
