"use client";
import type { JobDetail } from "@kr/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollDelay } from "@/lib/query/hooks";
import { refreshJob } from "./refreshJob";
import { useFollowedOperation } from "./useFollowedOperation";

/** Longest the zone keeps saying "Reading the conformed date…" after the scan, for a read that never changes the job. */
const READ_WAIT_MS = 20_000;

interface Awaiting {
  readonly scanOperationId: string;
  readonly fileId: string;
  /** The job's version when the upload finished: the read that follows the scan bumps it. */
  readonly version: number;
}

export interface AwaitedConformanceRead {
  /** A Conformance Notification was uploaded and its read has not shown in the job yet. */
  readonly waiting: boolean;
  /** Start waiting for the read that follows the scan of the file just uploaded. */
  readonly begin: (scanOperationId: string, fileId: string) => void;
}

/**
 * With scanning on, the upload answers with its `file.scan` operation; the worker queues the conformance read only once the scan
 * has passed, and no response names it, so there is nothing to poll for it. This follows the scan (refreshing the job when it
 * settles) and then refetches the job on the operation back-off until the read has changed it (its version moves on), the file
 * turns out unreadable, or {@link READ_WAIT_MS} has passed (a read that found nothing leaves the job as it was).
 */
export function useAwaitedConformanceRead(job: JobDetail): AwaitedConformanceRead {
  const queryClient = useQueryClient();
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const scan = useFollowedOperation(awaiting?.scanOperationId ?? null);
  const scanStatus = scan?.status;
  const fileStatus = awaiting
    ? job.checkpoints.flatMap((c) => c.files).find((file) => file.id === awaiting.fileId)?.scanStatus
    : undefined;
  const jobVersion = job.version;

  // Over once the read has moved the job on, or the file can never be read; the timer below ends the wait otherwise.
  const unreadable = scanStatus === "failed" || fileStatus === "infected" || fileStatus === "error";
  const waiting = awaiting !== null && !unreadable && jobVersion === awaiting.version;

  const scanned = waiting && scanStatus === "succeeded";
  useEffect(() => {
    if (!scanned) return;
    const startedAt = Date.now();
    let repolls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (Date.now() - startedAt > READ_WAIT_MS) {
        setAwaiting(null);
        return;
      }
      void refreshJob(queryClient);
      timer = setTimeout(tick, pollDelay(repolls++));
    };
    timer = setTimeout(tick, pollDelay(repolls++));
    return () => {
      clearTimeout(timer);
    };
  }, [scanned, queryClient]);

  // `begin` is called from the upload's promise, which may hold an older render: read the version it is now.
  const latestVersion = useRef(jobVersion);
  useEffect(() => {
    latestVersion.current = jobVersion;
  }, [jobVersion]);
  const begin = useCallback((scanOperationId: string, fileId: string) => {
    setAwaiting({ scanOperationId, fileId, version: latestVersion.current });
  }, []);
  return { waiting, begin };
}
