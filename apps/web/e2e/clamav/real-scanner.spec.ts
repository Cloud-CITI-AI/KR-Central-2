import type { Locator, Page } from "@playwright/test";
import { addDays, formatDateWithWeekday, outcomeDateFor } from "@kr/workflow";
import { expect, isolatedStackTest } from "../fixtures";
import { createJob, firstFileId, waitForOperation } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { compactDate, perthToday } from "../support/dates";
import { pdfFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// PRODUCT_SPEC §5.5 (conformance, outcome box), §10.1 (order of attempts) and §11 (malware scanning), on a stack whose worker
// scans with the real ClamAV container. A conformed date can only be read from a file that has been scanned clean, so these
// journeys live here. The worker reads the date of a synthetic Conformance Notification from the file name, then from page 1
// through the fake stamp-reading service. One stack, so one worker: the journeys run in order.
const test = isolatedStackTest({ label: "clamav", malwareScanning: "clamav", seed: true });
test.describe.configure({ mode: "serial" });

/**
 * Upload a Conformance Notification through the browser and wait until ClamAV has passed it (the "Read conformed date again"
 * button is enabled only for a clean file). Returns the card and the file's id.
 */
async function uploadClean(
  page: Page,
  jobId: string,
  name: string,
  session: Parameters<typeof firstFileId>[0],
  pages?: readonly (readonly string[])[],
) {
  const conformance: Locator = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile(name, pages));
  await expect(conformance.getByRole("button", { name: "Read conformed date again" })).toBeEnabled({ timeout: 30_000 });
  return { conformance, fileId: await firstFileId(session, jobId, "i4_2") };
}

test("the conformed date is taken from the file name, sets the outcome date 90 days on, and starts the countdown", async ({
  page,
  signInAs,
}) => {
  const staff = await signInAs(STAFF);
  const job = await createJob(staff);
  await openTracker(page, job.id);
  const outcome = page.getByRole("group", { name: "WAPC outcome" });
  await expect(
    outcome.getByText("Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown"),
  ).toBeVisible();

  // A date a few days back keeps the countdown in the future whatever day the suite runs.
  const conformed = addDays(perthToday(), -3);
  const name = `Conformance Notification ${compactDate(conformed)}.pdf`;
  const { fileId } = await uploadClean(page, job.id, name, staff);
  const started = await staff.post<{ id: string }>(`/v1/jobs/${job.id}/conformance-readings`, { fileId });
  const done = await waitForOperation(staff, started.id);
  expect(done.result).toMatchObject({
    found: true,
    message: `Taken from the file name: ${formatDateWithWeekday(conformed)}.`,
  });

  await page.reload();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(outcome.getByRole("textbox", { name: "Conformed date" })).toHaveValue(conformed);
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue(outcomeDateFor(conformed));
  await expect(outcome.getByText(`Read from ${name}`)).toBeVisible();
  await expect(outcome.getByText("90 days after the conformed date")).toBeVisible();
  await expect(outcome.getByRole("timer")).toContainText(
    `until outcome date – ${formatDateWithWeekday(outcomeDateFor(conformed))}`,
  );

  // By hand: a conformed date entered sets the outcome date again; an outcome date changed by hand can be reset.
  const byHand = addDays(perthToday(), -10);
  await outcome.getByRole("textbox", { name: "Conformed date" }).fill(byHand);
  await outcome.getByRole("textbox", { name: "Conformed date" }).press("Enter");
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue(outcomeDateFor(byHand));
  await expect(outcome.getByText("Entered by hand")).toBeVisible();
  await outcome.getByRole("textbox", { name: "WAPC outcome date" }).fill(addDays(outcomeDateFor(byHand), 30));
  await outcome.getByRole("textbox", { name: "WAPC outcome date" }).press("Enter");
  await expect(outcome.getByText("Changed by hand (e.g. deferral)")).toBeVisible();
  await outcome.getByRole("button", { name: "· reset to 90 days" }).click();
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue(outcomeDateFor(byHand));
});

test("without a date in the file name the stamp on page 1 is read", async ({ page, signInAs }) => {
  const staff = await signInAs(STAFF);
  const job = await createJob(staff);
  await openTracker(page, job.id);
  const { fileId } = await uploadClean(page, job.id, "Conformance Notification.pdf", staff, [
    ["Synthetic notification, no date here"],
  ]);
  const started = await staff.post<{ id: string }>(`/v1/jobs/${job.id}/conformance-readings`, { fileId });
  const done = await waitForOperation(staff, started.id);
  expect(done.result).toMatchObject({
    found: true,
    message: `Read from the stamp on page 1 ("DATE 16-Mar-2026 FILE 123-26"): ${formatDateWithWeekday("2026-03-16")}. Please check it below.`,
  });
  await page.reload();
  await page.getByRole("button", { name: "Expand all" }).click();
  const outcome = page.getByRole("group", { name: "WAPC outcome" });
  await expect(outcome.getByRole("textbox", { name: "Conformed date" })).toHaveValue("2026-03-16");
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue("2026-06-14");
  await expect(outcome.getByText("Read from Conformance Notification.pdf")).toBeVisible();
});

// Conformance Notification journeys with the real scanner: the upload answers with its file.scan operation, whose result names
// the conformance read the worker queued after the scan (FileScanResult.followUpOperationId); the zone follows both by id.
const readDate = addDays(perthToday(), -3);
const READ_FILE_NAME = `Conformance Notification ${compactDate(readDate)}.pdf`;
const TAKEN = `Taken from the file name: ${formatDateWithWeekday(readDate)}.`;

test("uploading a Conformance Notification starts the read by itself once the scan has passed: the outcome date appears with no button pressed", async ({
  page,
  signInAs,
}) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const outcome = page.getByRole("group", { name: "WAPC outcome" });
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile("Conformance Notification 2026-07-20.pdf"));
  await expect(conformance.getByText("Reading the conformed date…")).toBeVisible();
  // Scan (ClamAV), then the read the worker queued: the job is refetched on the operation back-off, not at the 15 s refresh.
  await expect(outcome.getByRole("textbox", { name: "Conformed date" })).toHaveValue("2026-07-20", { timeout: 30_000 });
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue("2026-10-18");
  await expect(outcome.getByText("Read from Conformance Notification 2026-07-20.pdf")).toBeVisible();
  await expect(conformance.getByText("Reading the conformed date…")).toBeHidden();
  await expect(conformance.getByRole("button", { name: "Read conformed date again" })).toBeEnabled();
});

test("the zone shows the result message of the read an upload started (§5.5: 'Result message under the zone')", async ({
  page,
  signInAs,
}) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile(READ_FILE_NAME));
  // The zone follows the file.scan, then the conformance.read its result names, to the message.
  await expect(conformance.getByText(TAKEN)).toBeVisible({ timeout: 30_000 });
});

test("'Read conformed date again' reads the date of a clean file (§10.1)", async ({ page, signInAs }) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile(READ_FILE_NAME));
  const read = conformance.getByRole("button", { name: "Read conformed date again" });
  await expect(read).toBeEnabled({ timeout: 30_000 });
  await read.click();
  await expect(conformance.getByText(TAKEN)).toBeVisible({ timeout: 30_000 });
});
