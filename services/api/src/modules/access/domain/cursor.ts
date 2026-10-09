/** Access-manager cursor: the id of the last grant on the page; the sort position is resolved in SQL. */
import { z } from "zod";

const Body = z.strictObject({ i: z.uuid() });

export function encodeGrantCursor(grantId: string): string {
  return Buffer.from(JSON.stringify({ i: grantId }), "utf8").toString("base64url");
}

/** The grant id a cursor stands for, or null when it is malformed. */
export function decodeGrantCursor(raw: string): string | null {
  try {
    const parsed = Body.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data.i : null;
  } catch {
    return null;
  }
}
