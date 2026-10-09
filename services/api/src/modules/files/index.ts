/**
 * Uploads, downloads, removal, job package zip, pasted emails. Public entry of the `files` module — STUB, implemented by WP-09.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const filesModule: ApiModule = {
  name: "files",
  operations: ["uploadFile", "getFile", "getFileContent", "deleteFile", "downloadJobPackage", "pasteEmail"],
  register() {
    // Implemented by WP-09.
  },
};
