import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";

// PRODUCT_SPEC §14: CLS <= 0.1. While the job loads the tracker page holds its place (TrackerSkeleton); when the job arrives the
// footer and the page column must not jump (it was 0.654: a spinner replaced by a 1300 px tracker). The throttled measurement is
// perf/web-vitals.spec.ts; this is the same check on the plain stack with the job answer held back by 1.5 s.

test("the tracker page does not shift when the job arrives after a slow answer", async ({ page, signInAs, apiAs }) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  await signInAs(STAFF);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const shifts: { value: number; hadRecentInput: boolean; sources: string[] }[] = [];
    (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        };
        shifts.push({
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          sources: (shift.sources ?? []).map(({ node }) => (node instanceof Element ? node.tagName : "?")),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route(`**/api/v1/jobs/${job.id}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.goto(`/jobs/${job.id}`);
  const skeleton = page.locator("[aria-busy='true']");
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByRole("status")).toHaveText("Loading job…");
  const footer = page.getByRole("contentinfo");
  const loadingFooterTop = (await footer.boundingBox())?.y ?? 0;
  // the placeholder reserves a whole screen and more: the footer starts below the fold, as it does under the real tracker
  expect(loadingFooterTop).toBeGreaterThan(800);

  await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  const loadedFooterTop = (await footer.boundingBox())?.y ?? 0;
  expect(loadedFooterTop).toBeGreaterThan(800);

  const shifts = await page.evaluate(
    () => (window as unknown as { __shifts: { value: number; hadRecentInput: boolean }[] }).__shifts,
  );
  const cls = shifts.filter((shift) => !shift.hadRecentInput).reduce((sum, shift) => sum + shift.value, 0);
  expect(cls, JSON.stringify(shifts)).toBeLessThanOrEqual(0.1);
});
