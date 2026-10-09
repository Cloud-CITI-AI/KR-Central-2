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
