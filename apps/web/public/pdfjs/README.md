# pdf.js runtime files (same origin)

Copied unchanged from `pdfjs-dist` **6.4.299** (Apache-2.0, see `LICENSE`) so the viewer's PDF worker, character maps,
standard fonts, ICC profile and image decoders are served by this app and never by a third party (CSP `worker-src 'self' blob:`,
`connect-src 'self'`). Used by `src/features/viewer/pdf-renderer.ts` through `/pdfjs/`.

| Here                 | From `node_modules/pdfjs-dist/`                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pdf.worker.min.mjs` | `build/pdf.worker.min.mjs`                                                                                 |
| `cmaps/`             | `cmaps/`                                                                                                   |
| `standard_fonts/`    | `standard_fonts/`                                                                                          |
| `iccs/`              | `iccs/`                                                                                                    |
| `wasm/`              | `wasm/` without `quickjs-eval.*` (scripting is never enabled) and without the `*_nowasm_fallback.js` files |

`pdfjs-assets.test.ts` fails when these files differ from the installed `pdfjs-dist`, so a version bump must refresh
them: from `apps/web`, `cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdfjs/` and re-copy the folders above.

## Not from pdfjs-dist: the polyfilled worker

The viewer starts `pdf.worker.polyfilled.mjs`, not `pdf.worker.min.mjs` directly. It is two `import` lines: first
`map-upsert-polyfill.mjs` (`Map`/`WeakMap` `getOrInsert` and `getOrInsertComputed`, ES2026, which pdf.js 6 needs and browsers
from before about early 2026 lack), then the unchanged worker. The page installs the same methods
(`src/features/viewer/map-upsert.ts`) before it loads pdf.js; `map-upsert.test.ts` keeps the two copies in step. Both files are served
from `/pdfjs/` (same origin), so CSP `worker-src 'self' blob:` still holds. Drop all three when the supported browsers have the methods.
