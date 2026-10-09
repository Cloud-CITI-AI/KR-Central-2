import { expect, test } from "../fixtures";
import { createJob, uniqueJobNumber } from "../harness/jobs";
import { KR_ADMIN, STAFF } from "../harness/users";

// PRODUCT_SPEC §5.1: EDIT JOB (job.edit) and Archive job (job.delete: admin and kr_admin only).

test("staff edit the job details, and a job number already in use is refused", async ({ page, signInAs, apiAs }) => {
  const staff = await apiAs(STAFF);
  const taken = await createJob(staff);
  const job = await createJob(staff, { address: "1 Before Street, Testville WA 6000" });
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);

  await page.getByRole("button", { name: "EDIT JOB" }).click();
  const dialog = page.getByRole("dialog", { name: "Job details" });
  await expect(dialog.getByRole("textbox", { name: "Address" })).toHaveValue("1 Before Street, Testville WA 6000");
  await dialog.getByRole("textbox", { name: "Job number" }).fill(taken.jobNumber);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText(`${taken.jobNumber} is already in use.`)).toBeVisible();

  const renumbered = uniqueJobNumber("E2E-R");
  await dialog.getByRole("textbox", { name: "Job number" }).fill(renumbered);
  await dialog.getByRole("textbox", { name: "Address" }).fill("2 After Avenue, Testville WA 6000");
  await dialog.getByRole("textbox", { name: "Client (optional)" }).fill("");
  await dialog.getByRole("combobox", { name: "Subdivision type" }).selectOption("Built Strata");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Job" })).toContainText(renumbered);
  await expect(page.getByRole("combobox", { name: "Job" })).toContainText("2 After Avenue");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Job" })).toContainText(renumbered);
});

test("staff cannot archive; a KR admin archives from the dialog and the job disappears for everyone", async ({
  page,
  signInAs,
  apiAs,
  browser,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "EDIT JOB" }).click();
  await expect(page.getByRole("button", { name: "Archive job…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  const adminContext = await browser.newContext();
  await signInAs(KR_ADMIN, adminContext);
  const admin = await adminContext.newPage();
  await admin.goto(`/jobs/${job.id}`);
  await admin.getByRole("button", { name: "EDIT JOB" }).click();
  await admin.getByRole("button", { name: "Archive job…" }).click();
  const confirm = admin.getByRole("dialog", { name: "Archive job" });
  await expect(confirm).toContainText(
    `Archive ${job.jobNumber}? It disappears from the dashboard and job picker for everyone, and client/architect access stops. Files and history are kept.`,
  );
  await confirm.getByRole("button", { name: "ARCHIVE" }).click();
  await expect(admin).toHaveURL(`/?archived=${encodeURIComponent(job.jobNumber)}`);
  await expect(admin.getByText(`${job.jobNumber} was archived.`)).toBeVisible();
  await adminContext.close();

  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
