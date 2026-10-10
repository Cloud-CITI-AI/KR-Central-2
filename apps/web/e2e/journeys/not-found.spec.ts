import type { MockUser } from "@kr/mock-idp";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { EXTERNAL_NO_GRANTS, FIRST_MEMBER, KR_ADMIN, STAFF } from "../harness/users";

// PRODUCT_SPEC §4 (Shell; not-found: "Branded 404 with request id" inside the normal shell) and §12 (WCAG 2.4.2 page titles).

const APP = "KR Surveys Subdivision Tracker";
const UNKNOWN_JOB = "00000000-0000-4000-8000-000000000999";

/** One header, one h1, one main, the footer, and the signed-in controls of `user`: never a second nested shell. */
async function expectOneShell(page: Page, user: MockUser, admin: boolean): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("banner")).toContainText(user.name);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(admin ? 1 : 0);
  await expect(page.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
}

test.describe("a job that cannot be shown", () => {
  test("is a 404 response inside one shell, for an unknown, malformed, archived or forbidden job", async ({
    page,
    signInAs,
    apiAs,
    browser,
  }) => {
    const archived = await createJob(await apiAs(STAFF));
    const visible = await createJob(await apiAs(STAFF));
    const adminContext = await browser.newContext();
    await signInAs(KR_ADMIN, adminContext);
    const archiver = await adminContext.newPage();
    await archiver.goto(`/jobs/${archived.id}`);
    await archiver.getByRole("button", { name: "EDIT JOB" }).click();
    await archiver.getByRole("button", { name: "Archive job…" }).click();
    await archiver.getByRole("dialog", { name: "Archive job" }).getByRole("button", { name: "ARCHIVE" }).click();
    await expect(archiver).toHaveURL(/archived=/);
    await adminContext.close();

    await signInAs(FIRST_MEMBER);
    for (const path of [`/jobs/${UNKNOWN_JOB}`, "/jobs/not-a-uuid", `/jobs/${archived.id}`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expectOneShell(page, FIRST_MEMBER, true);
      await expect(page).toHaveTitle(`Page not found | ${APP}`);
    }
    // The job that does exist is still there for the same person.
    expect((await page.goto(`/jobs/${visible.id}`))?.status()).toBe(200);

    // A guest with no grant gets the API's 404, shown the same way and without an Admin link.
    const guestContext = await browser.newContext();
    await signInAs(EXTERNAL_NO_GRANTS, guestContext);
    const guest = await guestContext.newPage();
    const response = await guest.goto(`/jobs/${visible.id}`);
    expect(response?.status()).toBe(404);
    await expectOneShell(guest, EXTERNAL_NO_GRANTS, false);
    await guestContext.close();
  });
});

test("pages are titled for what they show", async ({ page, signInAs, apiAs }) => {
  const job = await createJob(await apiAs(STAFF), {
    jobNumber: "P-4242",
    address: "5 Synthetic Road, Testville WA 6000",
  });
  await signInAs(STAFF);
  await page.goto("/");
  await expect(page).toHaveTitle(`Dashboard | ${APP}`);
  await page.goto(`/jobs/${job.id}`);
  await expect(page).toHaveTitle(`P-4242 – 5 Synthetic Road, Testville WA 6000 | ${APP}`);
});
