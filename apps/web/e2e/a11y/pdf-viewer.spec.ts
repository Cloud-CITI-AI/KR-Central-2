import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { ApiSession } from "../harness/api-client";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { violationsOn } from "../support/a11y";
import { pdfFile } from "../support/documents";
import { card, openTracker } from "../support/tracker";
import { expectFirstPageDrawn } from "../support/viewer";

// The in-app PDF viewer (PRODUCT_SPEC §11.1) in the browsers it must support (§14) and without a mouse (§12, WCAG 2.1.1).
// No polyfill is injected by the harness: whatever the browser lacks, the product has to supply (formerly known defects D4, D5).

/** A job with a three-page `feature-survey.pdf` in the feature survey box, opened in the viewer. */
async function openSurveyViewer(page: Page, staff: ApiSession, pages: number): Promise<Locator> {
  const job = await createJob(staff);
  const file = await pdfFile(
    "feature-survey.pdf",
    Array.from({ length: pages }, (_, index) => [`Synthetic feature survey, page ${(index + 1).toString()}`]),
  );
  await staff.upload(
    job.id,
    { checkpointKey: "i2_0", slot: "survey" },
    { name: file.name, bytes: file.buffer, type: file.mimeType },
  );
  await openTracker(page, job.id);
  await card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
  return page.getByRole("dialog", { name: "feature-survey.pdf" });
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

// Formerly known defect D5: pdf.js 6 needs `Map.prototype.getOrInsertComputed` (ES2026), which browsers from before about early 2026
// (iOS Safari included) lack. The product installs the methods itself, on the page and in the pdf.js worker.
test("D5: the PDF viewer draws pages in a browser without Map.getOrInsertComputed", async ({
  page,
  signInAs,
  apiAs,
}) => {
  // Take the methods away on the page whatever the browser ships...
  await page.addInitScript(() => {
    for (const collection of [Map, WeakMap]) {
      Reflect.deleteProperty(collection.prototype, "getOrInsert");
      Reflect.deleteProperty(collection.prototype, "getOrInsertComputed");
    }
  });
  // ...and in the worker, whose global an init script cannot reach: the polyfill module is its first import, so remove them before it runs.
  await page.route("**/pdfjs/map-upsert-polyfill.mjs", async (route) => {
    const response = await route.fetch();
    const remove = `for (const C of [Map, WeakMap]) { delete C.prototype.getOrInsert; delete C.prototype.getOrInsertComputed; }\n`;
    await route.fulfill({ response, body: `${remove}${await response.text()}` });
  });
  const staff = await apiAs(STAFF);
  await signInAs(STAFF);
  const viewer = await openSurveyViewer(page, staff, 1);
  await expectFirstPageDrawn(viewer);
  await expect(viewer.getByText(/couldn.t be drawn/)).toHaveCount(0);
  expect(await page.evaluate(() => "getOrInsertComputed" in Map.prototype)).toBe(true);
});
