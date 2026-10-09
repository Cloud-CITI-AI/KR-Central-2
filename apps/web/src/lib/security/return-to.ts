import { AuthLoginQuery } from "@kr/contracts";

const returnToSchema = AuthLoginQuery.shape.returnTo;

/**
 * A `returnTo` is kept only when it is a same-origin path (contract rule: starts with one "/", no "//", backslash or
 * whitespace, ≤ 512 chars) without control characters. Anything else is dropped (open-redirect defence, §3.1).
 */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  const parsed = returnToSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
