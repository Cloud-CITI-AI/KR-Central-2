/**
 * A stand-in for `next/navigation` in component tests: a URL held in memory that `router.replace` changes and
 * `useSearchParams` / `usePathname` read, so filters can be driven end to end. Use it with
 * `vi.mock("next/navigation", async () => (await import("./test-router")).navigationMock)`.
 */
import { useMemo, useSyncExternalStore } from "react";

let url = "/";
const listeners = new Set<() => void>();
/** Every `router.push` target, in order. */
export const pushed: string[] = [];

export function setTestUrl(next: string): void {
  url = next;
  pushed.length = 0;
  for (const listener of listeners) listener();
}
export function getTestUrl(): string {
  return url;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const read = () => url;
const parse = (value: string) => new URL(value, "http://localhost");

const router = {
  replace(href: string): void {
    url = href;
    for (const listener of listeners) listener();
  },
  push(href: string): void {
    pushed.push(href);
  },
};

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => parse(useSyncExternalStore(subscribe, read, read)).pathname,
  useSearchParams: () => {
    const current = useSyncExternalStore(subscribe, read, read);
    return useMemo(() => parse(current).searchParams, [current]);
  },
};
