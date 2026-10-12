"use client";
import type { JobCapability, JobDetail } from "@kr/contracts";
import type { StageKey } from "@kr/workflow";
import { notFound } from "next/navigation";
import { lazy, Suspense, useEffect } from "react";
import { ApiProblem } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { rememberLastJob } from "./lastJob";
import { loadFailedText, TRACKER_MESSAGES } from "./messages";
import { TrackerSkeleton } from "./TrackerSkeleton";
import { useJob } from "./useJob";

/**
 * The body (jobbar, summary panels, every stage's panels, notes and files) is only needed once the job has loaded, so it is a
 * lazy chunk instead of part of the route's first load (FE-9). The skeleton stands in while it arrives, and the chunk is
 * requested on mount, in parallel with the job request, so there is no second round trip after the data. React.lazy, not
 * next/dynamic: its runtime would cost more first-load bytes than it saves here.
 */
const loadTrackerBody = () => import("./TrackerBody").then((module) => ({ default: module.TrackerBody }));
const TrackerBody = lazy(loadTrackerBody);

export interface TrackerPageProps {
  readonly jobId: string;
  /** `?stage=<stageKey>`: the stage to open and scroll to. */
  readonly initialStage?: StageKey;
}

/** Capabilities that change what is on the page. A viewer with none of them is view-only (architects, §5.1). */
const WRITE_CAPABILITIES: readonly JobCapability[] = [
  "job.edit",
  "checkpoint.status.edit",
  "checkpoint.decision.record",
  "checkpoint.paid.record",
  "files.upload.staff_slots",
  "files.upload.client_slots",
];

export const isViewOnly = (job: JobDetail): boolean => !WRITE_CAPABILITIES.some((c) => job.capabilities.includes(c));

/**
 * The tracker page frame (§5): loads the job, turns problems into banners (§5.1), remembers the job for the dashboard's
 * back link and lays out the jobbar. A 404 (also what a job the person may not see answers) is the branded not-found page.
 */
export function TrackerPage({ jobId, initialStage }: TrackerPageProps) {
  const query = useJob(jobId);
  useEffect(() => {
    void loadTrackerBody();
  }, []);
  const { show, dismiss } = useBanners();
  const job = query.data;
  const error = query.error;
  if (error instanceof ApiProblem && error.status === 404) notFound();

  const viewOnly = job ? isViewOnly(job) : false;
  useEffect(() => {
    if (viewOnly) show("read-only", MESSAGES.readOnly);
    else dismiss("read-only");
    return () => {
      dismiss("read-only");
    };
  }, [viewOnly, show, dismiss]);

  const failureText = !error
    ? null
    : error instanceof ApiProblem && error.status === 0
      ? TRACKER_MESSAGES.offline
      : loadFailedText(error instanceof ApiProblem ? error.requestId : undefined);
  useEffect(() => {
    if (failureText) show("load", failureText);
    else dismiss("load");
  }, [failureText, show, dismiss]);

  const openedId = job?.id;
  useEffect(() => {
    if (openedId) rememberLastJob(openedId);
  }, [openedId]);

  if (!job) return error ? null : <TrackerSkeleton />;
  return (
    <Suspense fallback={<TrackerSkeleton />}>
      <TrackerBody job={job} initialStage={initialStage} />
    </Suspense>
  );
}
