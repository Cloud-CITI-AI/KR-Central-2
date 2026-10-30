import type { Page } from "@playwright/test";
import { expect, isolatedStackTest } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { pdfFile } from "../support/documents";
import { expectFirstPageDrawn } from "../support/viewer";
import { card } from "../support/tracker";

// Visual regression (PRODUCT_SPEC §12): the dashboard, the tracker and the document viewer in light and dark, at 1280 px and at 390 px.
// A stack of its own, so the pages hold only the two jobs below and every snapshot is the same on every run; the only dates the
// pages show are masked. Baselines live in e2e/visual/snapshots.spec.ts-snapshots and are reviewed in the pull request that changes
// them (`playwright test e2e/visual --update-snapshots` rewrites them). Make them with the Chromium build this Playwright version
// pins (the one CI installs), never with E2E_CHROMIUM_PATH pointing at another build: text antialiasing differs between builds.
const test = isolatedStackTest({ label: "visual", seed: true });
test.describe.configure({ mode: "serial" });

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

let jobs: { blank: string; withFile: string } | undefined;

/** Two jobs, made once per stack: the blank demo job (nothing set) and one with a PDF in its feature survey box. */
async function demoJobs(session: Parameters<typeof createJob>[0]): Promise<NonNullable<typeof jobs>> {
  if (jobs) return jobs;
  const blank = await createJob(session, {
    jobNumber: "DEMO-000",
    address: "Blank demo job",
    clientName: null,
    subdivisionType: "Survey-Strata",
  });
  const withFile = await createJob(session, {
    jobNumber: "DEMO-001",
    address: "Viewer demo job",
    clientName: "Synthetic Developments Pty Ltd",
    subdivisionType: "Freehold",
  });
  const file = await pdfFile("feature-survey.pdf", [["Synthetic feature survey, page 1"], ["Page 2"]]);
  await session.upload(
    withFile.id,
    { checkpointKey: "i2_0", slot: "survey" },
    { name: file.name, bytes: file.buffer, type: file.mimeType },
  );
  jobs = { blank: blank.id, withFile: withFile.id };
  return jobs;
}

/** Everything that changes from run to run: the notes' timestamps. */
const volatile = (page: Page) => [page.locator("time")];

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${theme} theme, ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((value) => {
          localStorage.setItem("kr-theme", value);
        }, theme);
      });
      const name = (view: string): string => `${view}-${theme}-${viewport.name}.png`;

      test("dashboard", async ({ page, signInAs }) => {
        await demoJobs(await signInAs(STAFF));
        await page.goto("/");
        await expect(page.getByRole("article")).toHaveCount(2);
        await expect(page).toHaveScreenshot(name("dashboard"), { fullPage: true, mask: volatile(page) });
      });

      test("tracker", async ({ page, signInAs }) => {
        const { blank } = await demoJobs(await signInAs(STAFF));
        await page.goto(`/jobs/${blank}`);
        await page.getByRole("button", { name: "Collapse all" }).click();
        await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
        await expect(page).toHaveScreenshot(name("tracker"), { fullPage: true, mask: volatile(page) });
      });

      test("summary panels, with the status key", async ({ page, signInAs }) => {
        const { blank } = await demoJobs(await signInAs(STAFF));
        await page.goto(`/jobs/${blank}`);
        const progress = page.getByRole("region", { name: "Subdivision progress" });
        const key = page.getByRole("region", { name: "Status key" });
        await expect(key).toBeVisible();
        // As in the prototype (blank-03): the heading's rule spans the whole panel, and the four rows share the panel's height.
        const heading = await key.getByRole("heading", { name: "Status key" }).boundingBox();
        const panel = await key.boundingBox();
        const last = await key.locator(":scope > div").last().boundingBox();
        if (!heading || !panel || !last) throw new Error("the status key is not laid out");
        expect(Math.abs(heading.width - (panel.width - 34))).toBeLessThanOrEqual(1);
        if (viewport.name === "desktop") {
          const beside = await progress.boundingBox();
          expect(Math.abs((beside?.height ?? 0) - panel.height)).toBeLessThanOrEqual(1);
          expect(panel.y + panel.height - (last.y + last.height)).toBeLessThanOrEqual(16);
        }
        await expect(page.locator("div").filter({ has: progress }).filter({ has: key }).last()).toHaveScreenshot(
          name("summary"),
          { mask: volatile(page) },
        );
      });

      test("document viewer", async ({ page, signInAs }) => {
        const { withFile } = await demoJobs(await signInAs(STAFF));
        await page.goto(`/jobs/${withFile}`);
        await page.getByRole("button", { name: "Expand all" }).click();
        await card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
        const viewer = page.getByRole("dialog", { name: "feature-survey.pdf" });
        await expect(viewer.locator("canvas")).toHaveCount(2);
        await expectFirstPageDrawn(viewer);
        await expect(viewer).toHaveScreenshot(name("viewer"));
      });
    });
  }
}
