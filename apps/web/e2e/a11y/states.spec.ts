import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createJob, grantAccess, patchCheckpoint, waitForOperation } from "../harness/jobs";
import { ARCHITECT_GUEST, CLIENT_GUEST, FIRST_MEMBER, STAFF } from "../harness/users";
import { expectAccessible } from "../support/a11y";
import { decisionLetter, dwgFile, emlFile, pdfFile, pngFile } from "../support/documents";
import { expectFirstPageDrawn } from "../support/viewer";
import { card, openTracker } from "../support/tracker";

// WCAG 2.2 AA (PRODUCT_SPEC §12) on every page and dialog a person can reach, in both themes, at desktop width and at 390 px.
// The one known defect left in these states is the pressed filter chip and the conditions links (D6, D7), tracked by e2e/a11y/known-defects.spec.ts.

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${theme} theme, ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((value) => {
          localStorage.setItem("kr-theme", value);
        }, theme);
      });
      const at = (state: string): string => `${theme} ${viewport.name}: ${state}`;

      test("signed-out pages", async ({ page }) => {
        for (const path of [
          "/sign-in",
          "/sign-in-error?reason=wrong_tenant",
          "/sign-in-error?reason=cancelled",
          "/signed-out",
        ]) {
          await page.goto(path);
          await settle(page);
          await expectAccessible(page, at(path));
        }
      });

      test("staff: dashboard, tracker, viewer and dialogs", async ({ page, signInAs, apiAs }) => {
        test.setTimeout(120_000);
        const staff = await apiAs(STAFF);
        const job = await createJob(staff, { clientName: "Accessible Developments Pty Ltd" });
        await createJob(staff, { subdivisionType: "Freehold" });
        await patchCheckpoint(staff, job.id, "i2_0", { status: "completed" });
        await patchCheckpoint(staff, job.id, "i4_0", { status: "not_required" });
        await signInAs(STAFF);

        await page.goto("/");
        await settle(page);
        await expectAccessible(page, at("dashboard"));
        await page.getByRole("searchbox", { name: "Search jobs" }).fill("no-such-job-anywhere");
        await expect(page.getByText("No jobs match.")).toBeVisible();
        await expectAccessible(page, at("dashboard, nothing matches"));
        await page.goto("/");
        const manager = page.getByRole("region", { name: "Access manager" });
        await manager.getByRole("button", { name: "Grant access" }).click();
        await expect(manager.getByText("Enter a valid email address, e.g. name@example.com.")).toBeVisible();
        await expectAccessible(page, at("access manager with validation errors"));
        await page.getByRole("button", { name: "New job" }).click();
        await page.getByRole("button", { name: "Create job" }).click();
        await expect(page.getByText("Enter the job number.", { exact: true })).toBeVisible();
        await expectAccessible(page, at("new job dialog with validation errors"));
        await page.keyboard.press("Escape");

        // A tracker with files, a note and extracted conditions.
        const upload = (key: string, slot: string, file: { name: string; buffer: Buffer; mimeType: string }) =>
          staff.upload(
            job.id,
            { checkpointKey: key, slot },
            { name: file.name, bytes: file.buffer, type: file.mimeType },
          );
        await upload("i2_0", "survey", await pdfFile("feature-survey.pdf", [["Synthetic feature survey"], ["Page 2"]]));
        await upload("i2_0", "survey", dwgFile("feature-survey.dwg"));
        await upload("i11_0", "photos", pngFile("setout-1.png"));
        const eml = emlFile("query-lot-12.eml", {
          subject: "Query about lot 12",
          body: "Please confirm the dimensions.",
        });
        const emailUpload = await upload("i4_3", "email", eml);
        if (emailUpload.operation) await waitForOperation(staff, emailUpload.operation.id);
        await upload(
          "i5_0",
          "decision",
          await decisionLetter("Decision Letter.pdf", [
            { text: "Underground power being provided to every lot.", agency: "Western Power" },
            { text: "Drainage plans being approved.", agency: "City of Stirling" },
          ]),
        );
        await staff.post(`/v1/jobs/${job.id}/notes`, { body: "Pegs placed on lots 1 to 4.", audience: "all" });

        await page.goto(`/jobs/${job.id}`);
        await settle(page);
        await expectAccessible(page, at("tracker, stages as first opened"));
        await page.getByRole("button", { name: "Collapse all" }).click();
        await expectAccessible(page, at("tracker, all stages collapsed"));
        await openTracker(page, job.id);
        await expect(card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true })).toBeVisible();
        await expectAccessible(page, at("tracker, all stages expanded, with files, email and notes"));

        const approval = card(page, "i5_0");
        await approval.getByRole("button", { name: "Extract conditions from Decision Letter" }).click();
        await expect(approval.getByText("2 conditions extracted")).toBeVisible();
        await expectAccessible(page, at("tracker with the conditions checklist"));

        await card(page, "i2_0").getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
        await expectFirstPageDrawn(page.getByRole("dialog", { name: "feature-survey.pdf" }));
        await expectAccessible(page, at("document viewer, PDF"));
        await page.getByRole("dialog").getByRole("button", { name: "Next file" }).click();
        await expect(page.getByRole("dialog", { name: "feature-survey.dwg" })).toBeVisible();
        await expectAccessible(page, at("document viewer, DWG download page"));
        await page.keyboard.press("Escape");
        await card(page, "i11_0").getByRole("button", { name: "setout-1.png" }).first().click();
        await expect(page.getByRole("dialog", { name: "setout-1.png" }).getByRole("img")).toBeVisible();
        await expectAccessible(page, at("document viewer, image"));
        await page.keyboard.press("Escape");
        await card(page, "i4_3")
          .getByRole("button", { name: "Query about lot 12", exact: true })
          .click({ timeout: 30_000 });
        await expect(page.getByRole("dialog", { name: "query-lot-12.eml" })).toBeVisible();
        await expectAccessible(page, at("document viewer, email"));
        await page.keyboard.press("Escape");

        await card(page, "i2_0").getByRole("button", { name: "Remove feature-survey.dwg" }).click();
        await expectAccessible(page, at("tracker, remove a file? confirmation"));
        await card(page, "i2_0").getByRole("button", { name: "No", exact: true }).click();

        await page.getByRole("button", { name: "EDIT JOB" }).click();
        await expect(page.getByRole("dialog", { name: "Job details" })).toBeVisible();
        await expectAccessible(page, at("job details dialog"));
        await page.getByRole("button", { name: "Cancel" }).click();

        await page.goto("/jobs/00000000-0000-4000-8000-000000000000");
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
        await expectAccessible(page, at("page not found"));
      });

      test("admin pages", async ({ page, signInAs }) => {
        await signInAs(FIRST_MEMBER);
        await page.goto("/admin/users");
        await expect(page.getByRole("region", { name: "Users" })).toBeVisible();
        await settle(page);
        await expectAccessible(page, at("admin users"));
        await page.goto("/admin/audit");
        await settle(page);
        await expectAccessible(page, at("admin audit trail"));
      });

      test("client and architect views", async ({ page, context, signInAs, apiAs }) => {
        const staff = await apiAs(STAFF);
        const job = await createJob(staff, { clientName: "Guest-visible Developments" });
        await grantAccess(staff, { jobId: job.id, email: CLIENT_GUEST.email!, role: "client" });
        await grantAccess(staff, { jobId: job.id, email: ARCHITECT_GUEST.email!, role: "architect" });
        for (const [role, person] of [
          ["client", CLIENT_GUEST],
          ["architect", ARCHITECT_GUEST],
        ] as const) {
          await context.clearCookies();
          await signInAs(person);
          await page.goto("/");
          await expect(page.getByRole("article", { name: job.jobNumber })).toBeVisible();
          await settle(page);
          await expectAccessible(page, at(`${role}: dashboard`));
          await openTracker(page, job.id);
          await settle(page);
          await expectAccessible(page, at(`${role}: tracker`));
        }
      });
    });
  }
}
