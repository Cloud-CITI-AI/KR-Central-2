import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { violationsOn } from "../support/a11y";
import { expectFirstPageDrawn } from "../support/viewer";
import { pdfFile } from "../support/documents";
import { card, openTracker } from "../support/tracker";

// Known product defect D3: the secondary text colours inherited from the prototype (#8c8c8c, #777777, #6d6c69; #8a8a8a in dark) are
// below the 4.5:1 WCAG 2.2 AA contrast ratio on the tracker (light: 141 elements, dark: 46) and on the dashboard's type chips
// (light). This test asserts the spec ("zero violations") and is marked as expected to fail, so the run stays green while the
// defect stands and goes red the day it is fixed: then delete the `test.fail` line and the `color-contrast` exclusion in support/a11y.ts.
test("D3: colour contrast meets WCAG 2.2 AA on the dashboard and the tracker", async ({ page, signInAs, apiAs }) => {
  test.fail(true, "D3: secondary text colours are below 4.5:1 (see the comment above)");
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto("/");
  expect(await violationsOn(page, { only: ["color-contrast"] }), "dashboard").toEqual([]);
  await openTracker(page, job.id);
  expect(await violationsOn(page, { only: ["color-contrast"] }), "tracker").toEqual([]);
});

// Known product defect D4: the PDF viewer's scrolling page area (`scroller`) has no focusable content and is not itself focusable, so a
// keyboard user cannot scroll through the pages (axe `scrollable-region-focusable`, WCAG 2.1.1). Expected to fail until fixed.
test("D4: the PDF viewer's page area can be scrolled with the keyboard", async ({ page, signInAs, apiAs }) => {
  test.fail(true, "D4: the viewer's scroller is not keyboard focusable (see the comment above)");
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const file = await pdfFile("feature-survey.pdf", [["Synthetic feature survey"], ["Page 2"]]);
  await staff.upload(
    job.id,
    { checkpointKey: "i2_0", slot: "survey" },
    { name: file.name, bytes: file.buffer, type: file.mimeType },
  );
  await signInAs(STAFF);
  await openTracker(page, job.id);
  await card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "feature-survey.pdf" }).locator("canvas").first()).toBeVisible();
  expect(await violationsOn(page, { only: ["scrollable-region-focusable"] })).toEqual([]);
});

// Known product defect D5: pdf.js 6 needs `Map.prototype.getOrInsertComputed` (ES2026), which browsers before roughly early 2026 lack
// (the Chromium 141 preinstalled in some sandboxes among them): there the viewer says "Page 1 couldn't be drawn." for every PDF. The
// product should ship the legacy pdf.js build or a polyfill. This test uses no polyfill; it expects to fail only in a browser that lacks
// the method, so on a current browser it passes as an ordinary test.
test("D5: the PDF viewer draws pages in a browser without Map.getOrInsertComputed", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const file = await pdfFile("feature-survey.pdf", [["Synthetic feature survey"]]);
  await staff.upload(
    job.id,
    { checkpointKey: "i2_0", slot: "survey" },
    { name: file.name, bytes: file.buffer, type: file.mimeType },
  );
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const supported = await page.evaluate(() => "getOrInsertComputed" in Map.prototype);
  test.fail(!supported, "D5: this browser lacks Map.getOrInsertComputed, which pdf.js 6 needs (see the comment above)");
  await card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
  await expectFirstPageDrawn(page.getByRole("dialog", { name: "feature-survey.pdf" }));
});
