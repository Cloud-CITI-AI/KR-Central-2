/**
 * Job notes (PRODUCT_SPEC §5.7). Public entry of the `notes` module (WP-11). Audit actions: `note.created`
 * (`audience`, `bodyLength`), `note.deleted` (`deleted`); entity_type `note`, job_id set; text is never audited.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerNoteRoutes } from "./http/routes.js";

export const notesModule: ApiModule = {
  name: "notes",
  operations: ["listNotes", "createNote", "deleteNote"],
  register(app, deps) {
    registerNoteRoutes(app, deps);
  },
};
