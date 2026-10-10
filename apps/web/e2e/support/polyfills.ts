import type { Page } from "@playwright/test";

/**
 * `Map.prototype.getOrInsert` and `getOrInsertComputed` (ES2026, in current Chrome, Firefox and Safari) are what pdf.js 6 needs to draw
 * a page. The Chromium that ships with older Playwright builds (and the one preinstalled in some sandboxes) lacks them, so the viewer
 * shows "Page 1 couldn't be drawn." there (known defect D5, e2e/a11y/known-defects.spec.ts). Journeys that need the PDF drawn call
 * `installUpsert` to behave like a current browser; it does nothing in a browser that has them.
 */
const UPSERT = `
for (const C of [Map, WeakMap]) {
  if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
  if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); };
}
`;

/** Give the page, and the pdf.js worker it starts, the upsert methods when the browser lacks them. */
export async function installUpsert(page: Page): Promise<void> {
  await page.addInitScript(UPSERT);
  await page.route("**/pdfjs/pdf.worker.min.mjs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${UPSERT}${await response.text()}` });
  });
}
