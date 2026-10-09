/**
 * Uploads, downloads, removal, job package zip, pasted emails. Public entry of the `files` module (WP-09).
 * Audit action names and behaviour worth knowing: see README.md.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerDeleteRoutes } from "./http/delete-routes.js";
import { registerFileRoutes } from "./http/file-routes.js";
import { registerPasteRoutes } from "./http/paste-routes.js";
import { registerUploadRoutes } from "./http/upload-routes.js";

export const filesModule: ApiModule = {
  name: "files",
  operations: ["uploadFile", "getFile", "getFileContent", "deleteFile", "downloadJobPackage", "pasteEmail"],
  register(app, deps) {
    registerUploadRoutes(app, deps);
    registerFileRoutes(app, deps);
    registerDeleteRoutes(app, deps);
    registerPasteRoutes(app, deps);
  },
};
