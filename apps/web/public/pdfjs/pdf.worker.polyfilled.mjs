// The worker the viewer starts (PDFJS_WORKER_SRC in src/features/viewer/pdf-renderer.ts): it installs the ES2026 polyfills and
// then runs the unchanged pdf.worker.min.mjs. Static imports evaluate in order, so the polyfill is in place before pdf.js starts.
import "./es2026-polyfills.mjs";
import "./pdf.worker.min.mjs";
