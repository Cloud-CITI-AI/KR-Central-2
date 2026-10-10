import { formatDateWithWeekday } from "@kr/workflow";
import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { pdfFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// PRODUCT_SPEC §5.5 (`conformance`, outcome box) and §10.1: uploading a Conformance Notification PDF starts a conformance read
// by itself. The main stack runs with MALWARE_SCAN_MODE=disabled (files are "skipped"), so the API queues the read with the
// upload and the zone follows it; the scanning-on path (worker queues it after a clean scan) is in clamav/real-scanner.spec.ts.

test("dropping a Conformance Notification starts the read: 'Reading the conformed date…', the result message, then the 90-day outcome date", async ({
  page,
  signInAs,
}) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const outcome = page.getByRole("group", { name: "WAPC outcome" });
  await expect(
    outcome.getByText("Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown"),
  ).toBeVisible();

  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile("Conformance Notification 2026-07-20.pdf"));
  await expect(conformance.getByText("Reading the conformed date…")).toBeVisible();
  // The job refreshes when the read ends (not at the 15 s periodic refetch), so the message and the dates arrive together.
  await expect(conformance.getByText(`Taken from the file name: ${formatDateWithWeekday("2026-07-20")}.`)).toBeVisible({
    timeout: 12_000,
  });
  await expect(conformance.getByText("Reading the conformed date…")).toBeHidden();
  await expect(outcome.getByRole("textbox", { name: "Conformed date" })).toHaveValue("2026-07-20");
  await expect(outcome.getByRole("textbox", { name: "WAPC outcome date" })).toHaveValue("2026-10-18");
  await expect(outcome.getByText("Read from Conformance Notification 2026-07-20.pdf")).toBeVisible();
  await expect(outcome.getByText("90 days after the conformed date")).toBeVisible();
  await expect(outcome.getByRole("timer")).toContainText(formatDateWithWeekday("2026-10-18"));
  await expect(outcome.getByText("Drop the Conformance Notification in 4.2")).toBeHidden();
});

test("'Read conformed date again' works for a file the scan skipped and shows its result", async ({
  page,
  signInAs,
}) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile("Conformance Notification 2026-07-20.pdf"));
  const taken = conformance.getByText(`Taken from the file name: ${formatDateWithWeekday("2026-07-20")}.`);
  await expect(taken).toBeVisible({ timeout: 12_000 });

  // A page reload drops the message; the button is enabled although the file is "skipped" and sends its Idempotency-Key.
  await page.reload();
  await page.getByRole("button", { name: "Expand all" }).click();
  const again = conformance.getByRole("button", { name: "Read conformed date again" });
  await expect(again).toBeEnabled();
  const request = page.waitForRequest((r) => r.url().includes("/conformance-readings") && r.method() === "POST");
  await again.click();
  expect((await request).headers()["idempotency-key"]).toBeTruthy();
  await expect(taken).toBeVisible({ timeout: 12_000 });
});
