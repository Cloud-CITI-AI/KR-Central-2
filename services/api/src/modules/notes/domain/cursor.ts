/** Notes cursor: the id of the last note on the page. Keyset position is resolved in SQL, so no precision is lost. */
import { z } from "zod";

const Body = z.strictObject({ i: z.uuid() });

export function encodeNoteCursor(noteId: string): string {
  return Buffer.from(JSON.stringify({ i: noteId }), "utf8").toString("base64url");
}

/** The note id a cursor stands for, or null when it is malformed. */
export function decodeNoteCursor(raw: string): string | null {
  try {
    const parsed = Body.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data.i : null;
  } catch {
    return null;
  }
}
