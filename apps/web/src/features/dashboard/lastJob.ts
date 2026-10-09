"use client";
import { useSyncExternalStore } from "react";
import { z } from "zod";

/** localStorage key the tracker (WP-14) writes with the id of the job last opened. */
export const LAST_JOB_KEY = "kr-last-job";

/** The remembered job id, or null when there is none, it is not an id, or storage is blocked (private window). */
export function readLastJobId(): string | null {
  try {
    const parsed = z.uuid().safeParse(localStorage.getItem(LAST_JOB_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("storage", listener);
  };
}

/** The last opened job id; null on the server and until the browser has been read (no hydration mismatch). */
export function useLastJobId(): string | null {
  return useSyncExternalStore(subscribe, readLastJobId, () => null);
}
