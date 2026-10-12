import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { ApiSession } from "../harness/api-client";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { violationsOn } from "../support/a11y";
import { pdfFile, type SyntheticFile } from "../support/documents";
import { aes256OwnerPasswordPdf } from "../support/encrypted-pdf";
import { card, openTracker } from "../support/tracker";
import { expectFirstPageDrawn } from "../support/viewer";

// The in-app PDF viewer (PRODUCT_SPEC §11.1) in the browsers it must support (§14) and without a mouse (§12, WCAG 2.1.1).
// No polyfill is injected by the harness: whatever the browser lacks, the product has to supply (formerly known defects D4, D5).

/** A job with `file` in the feature survey box, opened in the viewer. */
async function openUploadedViewer(page: Page, staff: ApiSession, file: SyntheticFile): Promise<Locator> {
  const job = await createJob(staff);
  await staff.upload(
    job.id,
    { checkpointKey: "i2_0", slot: "survey" },
    { name: file.name, bytes: file.buffer, type: file.mimeType },
  );
  await openTracker(page, job.id);
  await card(page, "i2_0").getByRole("button", { name: file.name, exact: true }).click();
  return page.getByRole("dialog", { name: file.name });
}

/** A job with a `feature-survey.pdf` of `pages` pages in the feature survey box, opened in the viewer. */
async function openSurveyViewer(page: Page, staff: ApiSession, pages: number): Promise<Locator> {
  const file = await pdfFile(
    "feature-survey.pdf",
    Array.from({ length: pages }, (_, index) => [`Synthetic feature survey, page ${(index + 1).toString()}`]),
  );
  return openUploadedViewer(page, staff, file);
}

test("D4: the PDF viewer's pages can be scrolled with the keyboard", async ({ page, signInAs, apiAs }) => {
  const staff = await apiAs(STAFF);
  await signInAs(STAFF);
  const viewer = await openSurveyViewer(page, staff, 3);
  await expect(viewer.locator("canvas")).toHaveCount(3);
  await expectFirstPageDrawn(viewer);

  // Tab reaches the page column (a named region), and it shows where the focus is.
  const pages = viewer.getByRole("region", { name: "Pages of feature-survey.pdf" });
  await expect(pages).toHaveAttribute("tabindex", "0");
  for (let presses = 0; presses < 12; presses++) {
    if (await pages.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(pages).toBeFocused();
  expect(await pages.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  expect(await pages.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const scrollTop = () => pages.evaluate((element) => element.scrollTop);
  expect(await scrollTop()).toBe(0);
  await page.keyboard.press("ArrowDown");
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const afterArrow = await scrollTop();
  await page.keyboard.press("PageDown");
  await expect.poll(scrollTop).toBeGreaterThan(afterArrow);
  await page.keyboard.press("End");
  await expect
    .poll(() => pages.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Home");
  await expect.poll(scrollTop).toBe(0);

  expect(await violationsOn(page, { only: ["scrollable-region-focusable"] })).toEqual([]);
});

// Formerly known defect D5, and its round-2 sequel: pdf.js 6 needs ES2025/2026 built-ins that browsers from before about early 2026
// (iOS Safari included) lack: `Map.prototype.getOrInsertComputed` and, found later, `Math.sumPrecise`, which the worker calls for every
// embedded font and for the AES-256 (PDF 2.0) decryption. The product installs them itself, on the page and in the pdf.js worker.
const REMOVE_BUILTINS = `
for (const C of [Map, WeakMap]) { delete C.prototype.getOrInsert; delete C.prototype.getOrInsertComputed; }
delete Math.sumPrecise;
delete Promise.try;
delete Promise.withResolvers;
delete Uint8Array.fromBase64;
delete Uint8Array.prototype.toBase64;
delete Uint8Array.prototype.toHex;
delete Set.prototype.intersection;
delete URL.parse;
delete globalThis.Iterator;
`;

/** Takes the built-ins away on the page whatever the browser ships, and in the worker (its global is out of reach of init scripts). */
async function withoutModernBuiltins(page: Page): Promise<string[]> {
  await page.addInitScript(REMOVE_BUILTINS);
  // The polyfill module is the worker's first import, so removing them before it runs reaches the worker.
  await page.route("**/pdfjs/es2026-polyfills.mjs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${REMOVE_BUILTINS}\n${await response.text()}` });
  });
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/is not a function|is not defined/.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

test("D5: the PDF viewer draws pages in a browser without the ES2025/2026 built-ins pdf.js uses", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const problems = await withoutModernBuiltins(page);
  const staff = await apiAs(STAFF);
  await signInAs(STAFF);
  const viewer = await openSurveyViewer(page, staff, 1);
  await expectFirstPageDrawn(viewer);
  await expect(viewer.getByText(/couldn.t be drawn/)).toHaveCount(0);
  expect(await page.evaluate(() => "getOrInsertComputed" in Map.prototype)).toBe(true);
  expect(await page.evaluate(() => typeof (Math as { sumPrecise?: unknown }).sumPrecise)).toBe("function");
  expect(problems).toEqual([]);
});

test("R2: an AES-256 PDF with only an owner password opens without Math.sumPrecise", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const problems = await withoutModernBuiltins(page);
  const staff = await apiAs(STAFF);
  await signInAs(STAFF);
  const viewer = await openUploadedViewer(
    page,
    staff,
    aes256OwnerPasswordPdf("owner-locked.pdf", ["Synthetic owner password only page"]),
  );
  await expectFirstPageDrawn(viewer);
  await expect(viewer.getByText(/couldn.t load this pdf|couldn.t be drawn/i)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("R2: a browser-printed PDF with embedded fonts draws them without Math.sumPrecise", async ({
  page,
  context,
  signInAs,
  apiAs,
}) => {
  // Chromium's own print-to-PDF embeds the page's fonts as TrueType/CID subsets, the kind pdf.js sanitises with Math.sumPrecise.
  const printer = await context.newPage();
  await printer.setContent(
    '<body style="font:28px serif"><h1>Synthetic printed survey</h1><p style="font-family:sans-serif">Embedded font text</p></body>',
  );
  const printed = await printer.pdf({ format: "A4" });
  await printer.close();

  const problems = await withoutModernBuiltins(page);
  const staff = await apiAs(STAFF);
  await signInAs(STAFF);
  const viewer = await openUploadedViewer(page, staff, {
    name: "printed.pdf",
    mimeType: "application/pdf",
    buffer: printed,
  });
  await expectFirstPageDrawn(viewer);
  expect(problems).toEqual([]);
});
