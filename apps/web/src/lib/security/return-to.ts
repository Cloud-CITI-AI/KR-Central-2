import { hasControlChars } from "./chars";

/** The contract's `AuthLoginQuery.returnTo` rule, written out so the API client does not load Zod; return-to.test.ts compares them. */
const MAX_LENGTH = 512;
const SAME_ORIGIN_PATH = /^\/(?!\/)[^\s\\]*$/;

/**
 * A `returnTo` is kept only when it is a same-origin path (contract rule: starts with one "/", no "//", backslash or
 * whitespace, ≤ 512 chars) without control characters. Anything else is dropped (open-redirect defence, §3.1).
 */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || hasControlChars(value)) return undefined;
  return value.length <= MAX_LENGTH && SAME_ORIGIN_PATH.test(value) ? value : undefined;
}
