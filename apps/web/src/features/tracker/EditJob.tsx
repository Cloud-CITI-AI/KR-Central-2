"use client";
import type { JobDetail } from "@kr/contracts";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { decodeFields, draftKey, encodeFields, useDraft } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { useSession } from "@/lib/session";
import { ArchiveJobDialog } from "./ArchiveJobDialog";
import { JOB_DETAILS_FIELDS, type JobDetailsValues } from "./jobDetailsFields";

// The dialog validates with the contract's schema (Zod): loaded when EDIT JOB is first used, not with the tracker (FE-9).
const JobDetailsDialog = dynamic(() => import("./JobDetailsDialog").then((module) => module.JobDetailsDialog));

export interface EditJobProps {
  readonly job: JobDetail;
}

/** EDIT JOB (`job.edit`, §5.1) and, with `job.delete`, the archive link and confirmation inside its dialog. Edits not saved when
 * the session ends come back in the reopened dialog after sign-in (§3.1, §15). */
export function EditJob({ job }: EditJobProps) {
  const [details, setDetails] = useState(false);
  // Mounted at the first EDIT JOB and kept, so closing returns focus to the button as the Dialog does.
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const canArchive = job.capabilities.includes("job.delete");

  const { user } = useSession();
  const banners = useBanners();
  // What the open dialog holds that the job does not (null otherwise): read when a 401 sends the person to sign-in.
  const edits = useRef<JobDetailsValues | null>(null);
  const [restored, setRestored] = useState<JobDetailsValues | undefined>(undefined);
  useDraft(
    job.capabilities.includes("job.edit") ? draftKey(user.id, job.id, "details") : undefined,
    () => (edits.current ? encodeFields(edits.current) : null),
    (stored) => {
      const values = decodeFields(stored, JOB_DETAILS_FIELDS);
      if (!values) return;
      edits.current = values;
      setRestored(values);
      setDetails(true);
      setDetailsLoaded(true);
      banners.show("draft-restored", MESSAGES.draftRestored);
    },
  );
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
          initial={restored}
          onEdit={(values) => {
            edits.current = values;
          }}
          onClose={() => {
            edits.current = null;
            setRestored(undefined);
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
