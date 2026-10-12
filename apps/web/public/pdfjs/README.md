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
`es2026-polyfills.mjs` (the ES2024 to ES2026 built-ins pdf.js 6 calls and browsers from before about early 2026 lack: `Map`/`WeakMap`
`getOrInsert` and `getOrInsertComputed`, `Math.sumPrecise`, `Promise.try`, `Promise.withResolvers`, `Uint8Array` `toHex`, `toBase64` and
`fromBase64`, `Set.prototype.intersection`, `URL.parse` and the `Iterator` global), then the unchanged worker. The page installs the same
functions (`src/features/viewer/es2026-polyfills.ts`) before it loads pdf.js; `es2026-polyfills.test.ts` runs one suite over both copies.
A version bump of `pdfjs-dist` must re-audit the build for new built-ins (`grep -o -E 'Math\.[a-zA-Z]+|Promise\.[a-z]+|Uint8Array\.[a-zA-Z]+|URL\.[a-z]+' node_modules/pdfjs-dist/build/pdf.worker.mjs | sort -u`). Both files are served
from `/pdfjs/` (same origin), so CSP `worker-src 'self' blob:` still holds. Drop all three when the supported browsers have the methods.
