import { addDays, formatDateWithWeekday } from "@kr/workflow";
import { expect, isolatedStackTest } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { compactDate, perthToday } from "../support/dates";
import { pdfFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// KNOWN PRODUCT DEFECTS, reported to the orchestrator by WP-19 (which does not fix product code). These journeys assert what
// PRODUCT_SPEC §5.5 and §10.1 say, so they FAIL today. They are not part of `pnpm test:e2e`: run them with `E2E_DEFECTS=1`
// (project "defects"). Once the defects are fixed they pass, and the project should be folded into the normal suite.
const test = isolatedStackTest({ label: "defects", malwareScanning: "clamav", seed: true });
test.describe.configure({ mode: "default" });

const conformed = addDays(perthToday(), -3);
const FILE_NAME = `Conformance Notification ${compactDate(conformed)}.pdf`;
const TAKEN = `Taken from the file name: ${formatDateWithWeekday(conformed)}.`;

test("D1: uploading a Conformance Notification starts the reading by itself (§5.5: 'Uploading a PDF starts a conformance read')", async ({
  page,
  signInAs,
}) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile(FILE_NAME));
  // The upload response is meant to carry the conformance.read operation (contract UploadResult.operation) and the zone says
  // "Reading the conformed date…" while it runs; the date then appears without anyone pressing a button.
  await expect(conformance.getByText(TAKEN)).toBeVisible({ timeout: 45_000 });
});

test("D2: 'Read conformed date again' reads the date of a clean file (§10.1)", async ({ page, signInAs }) => {
  const job = await createJob(await signInAs(STAFF));
  await openTracker(page, job.id);
  const conformance = card(page, "i4_2");
  await fileInput(conformance).setInputFiles(await pdfFile(FILE_NAME));
  const read = conformance.getByRole("button", { name: "Read conformed date again" });
  await expect(read).toBeEnabled({ timeout: 45_000 });
  await read.click();
  // Today startConformanceReading is sent without the Idempotency-Key header the route requires: 400, and the card says
  // "<file> couldn't be sent to be read (Request ID: …)".
  await expect(conformance.getByText(TAKEN)).toBeVisible({ timeout: 30_000 });
});
