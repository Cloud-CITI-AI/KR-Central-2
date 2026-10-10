// The worker the viewer starts (PDFJS_WORKER_SRC in src/features/viewer/pdf-renderer.ts): it installs the Map upsert polyfill and
// then runs the unchanged pdf.worker.min.mjs. Static imports evaluate in order, so the polyfill is in place before pdf.js starts.
import "./map-upsert-polyfill.mjs";
import "./pdf.worker.min.mjs";
