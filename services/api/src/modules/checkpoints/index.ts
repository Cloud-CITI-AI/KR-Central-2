/**
 * Checkpoint status, responsibility, KR note, client decisions and paid responses. Public entry of the `checkpoints` module — STUB, implemented by WP-08.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const checkpointsModule: ApiModule = {
  name: "checkpoints",
  operations: ["updateCheckpoint", "recordDecision", "markPaid", "undoPaid"],
  register() {
    // Implemented by WP-08.
  },
};
