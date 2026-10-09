"use client";
import type { JobDetail } from "@kr/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { JobDetailsDialog } from "./JobDetailsDialog";

export interface EditJobProps {
  readonly job: JobDetail;
}

/** EDIT JOB (`job.edit`, §5.1): opens the "Job details" dialog. */
export function EditJob({ job }: EditJobProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        EDIT JOB
      </Button>
      <JobDetailsDialog
        job={job}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
