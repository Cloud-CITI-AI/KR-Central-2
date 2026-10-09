/**
 * email.parse (PRODUCT_SPEC §10.3): reads an uploaded .msg or .eml in the parse thread and fills email_messages. A pasted
 * email is already parsed. A document that cannot be parsed marks the email `failed` and fails the operation with the
 * parser's code. Idempotent: an email that is already `parsed` is left alone.
 */
import type { Db } from "@kr/db";
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import { z } from "zod";
import type { WorkerConfig } from "../config.js";
import { findEmailTarget, saveEmail } from "../data/emails.js";
import { toEmailFields } from "../domain/email-fields.js";
import { TaskError } from "../errors.js";
import { readObject } from "../objects.js";
import type { Parser } from "../parsing/isolate.js";
import type { Handler } from "./types.js";

const Payload = z.object({ fileId: z.uuid() });

export interface EmailParseDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly parser: Parser;
  readonly config: Pick<WorkerConfig, "UPLOAD_MAX_BYTES">;
}

export function emailParseHandler({ db, storage, parser, config }: EmailParseDeps): Handler {
  return {
    timeoutMs: 120_000,
    async run(ctx) {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const email = await findEmailTarget(db, payload.data.fileId);
      if (email?.job_id !== ctx.operation.job_id || email.deleted_at || email.purged_at) return { parseStatus: "gone" };
      if (email.is_pasted || email.parse_status === "parsed") return { parseStatus: "parsed" };
      if (email.scan_status !== "clean" && email.scan_status !== "skipped") {
        throw new TaskError("file_not_ready", "The email has not passed the virus check, so it was not read.");
      }
      const data = await readObject(storage, email.storage_key, config.UPLOAD_MAX_BYTES).catch(
        async (error: unknown) => {
          if (!(error instanceof ObjectNotFoundError)) throw error;
          await saveEmail(db, email.id, null);
          throw new TaskError("file_missing", "The stored file could not be found.", { cause: error });
        },
      );
      try {
        const parsed = await parser.run("email", { data }, ctx.signal);
        await saveEmail(db, email.id, toEmailFields(parsed));
      } catch (error) {
        if (!ctx.signal.aborted && error instanceof TaskError) await saveEmail(db, email.id, null);
        throw error;
      }
      return { parseStatus: "parsed" };
    },
  };
}
