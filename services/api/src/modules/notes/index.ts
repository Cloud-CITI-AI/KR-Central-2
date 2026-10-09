/**
 * Job notes. Public entry of the `notes` module — STUB, implemented by WP-11.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const notesModule: ApiModule = {
  name: "notes",
  operations: ["listNotes", "createNote", "deleteNote"],
  register() {
    // Implemented by WP-11.
  },
};
