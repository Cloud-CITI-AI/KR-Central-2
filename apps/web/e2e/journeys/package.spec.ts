import { readFileSync } from "node:fs";
import { expect, test } from "../fixtures";
import { createJob, getJob, waitForOperation } from "../harness/jobs";
import { KR_ADMIN, STAFF } from "../harness/users";
import { decisionLetter, emlFile, pdfFile, type SyntheticFile } from "../support/documents";
import { readZip } from "../support/zip";

// PRODUCT_SPEC §5.8: the job's files as one streamed zip, with the folder layout and Job summary.txt. The job is built through
// the API (as the browser would), the download is the link in the page.

test("DOWNLOAD ALL FILES (.ZIP) streams the files in the stage layout with a job summary, and fee proposal files only for those who may see them", async ({
  signInAs,
  apiAs,
  browser,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff, { address: "9 Zip Lane, Testville WA 6000" });
  const upload = (key: string, slot: string, file: SyntheticFile) =>
    staff.upload(job.id, { checkpointKey: key, slot }, { name: file.name, bytes: file.buffer, type: file.mimeType });
  await upload("i2_0", "survey", await pdfFile("feature-survey.pdf"));
  // Staff cannot see the fee proposal (developer note 2), so the KR admin puts its file there.
  const proposal = await pdfFile("fee-proposal.pdf");
  await (
    await apiAs(KR_ADMIN)
  ).upload(
    job.id,
    { checkpointKey: "i1_0p", slot: "documents" },
    { name: proposal.name, bytes: proposal.buffer, type: proposal.mimeType },
  );
  const eml = emlFile("query.eml", { subject: "Query about lot 12", body: "Please confirm." });
  const emailUpload = await staff.upload(
    job.id,
    { checkpointKey: "i4_3", slot: "email" },
    { name: eml.name, bytes: eml.buffer, type: eml.mimeType },
  );
  if (emailUpload.operation) await waitForOperation(staff, emailUpload.operation.id);
  const letter = await decisionLetter("Decision Letter.pdf", [
    { text: "Underground power being provided.", agency: "Western Power" },
    { text: "Drainage being approved.", agency: "City of Stirling" },
  ]);
  const letterUpload = await upload("i5_0", "decision", letter);
  const extraction = await staff.post<{ id: string }>(`/v1/jobs/${job.id}/conditions/extractions`, {
    fileId: letterUpload.file.id,
    replaceExisting: false,
  });
  await waitForOperation(staff, extraction.id);
  const conditionId = (await getJob(staff, job.id)).conditions[0]?.id ?? "";
  const evidence = await pdfFile("pole-photo-approval.pdf");
  await staff.upload(job.id, { conditionId }, { name: evidence.name, bytes: evidence.buffer, type: evidence.mimeType });
  await staff.post(`/v1/jobs/${job.id}/notes`, { body: "Zip note for the summary.", audience: "all" });

  const root = `${job.jobNumber} – 9 Zip Lane, Testville WA 6000`;
  const download = async (as: typeof STAFF) => {
    const context = await browser.newContext();
    await signInAs(as, context);
    const tab = await context.newPage();
    await tab.goto(`/jobs/${job.id}`);
    const headers = tab.waitForResponse((r) => r.url().endsWith(`/jobs/${job.id}/package`));
    const [saved] = await Promise.all([
      tab.waitForEvent("download"),
      tab.getByRole("link", { name: "DOWNLOAD ALL FILES (.ZIP)" }).click(),
    ]);
    const files = readZip(readFileSync(await saved.path()));
    const disposition = (await (await headers).allHeaders())["content-disposition"] ?? "";
    await context.close();
    return { disposition, files };
  };

  // Staff: every clean file in the stage layout, but not the fee proposal.
  const forStaff = await download(STAFF);
  expect(forStaff.disposition).toContain(
    `filename*=UTF-8''${encodeURIComponent(`${job.jobNumber} – subdivision files.zip`)}`,
  );
  expect([...forStaff.files.keys()].sort()).toEqual(
    [
      `${root}/01 Preliminaries/2.0 Site Feature Survey/feature-survey.pdf`,
      `${root}/02 WAPC Approval/4.3 Queries from WAPC/Query emails/query.eml`,
      `${root}/02 WAPC Approval/5.0 WAPC conditional approval received/Decision Letter.pdf`,
      `${root}/03 Western Power/WAPC conditions/Condition 1 evidence/pole-photo-approval.pdf`,
      `${root}/Job summary.txt`,
    ].sort(),
  );
  const summary = forStaff.files.get(`${root}/Job summary.txt`)?.toString("utf8") ?? "";
  expect(summary).toContain(
    `${job.jobNumber} – 9 Zip Lane, Testville WA 6000 – Synthetic Developments Pty Ltd (Survey-Strata)`,
  );
  expect(summary).toContain("02 WAPC APPROVAL");
  expect(summary).toContain("04 WATER CORPORATION  (not required – no conditions in the Decision Letter)");
  expect(summary).toContain("WAPC CONDITIONS");
  expect(summary).toContain("Underground power being provided. (Western Power)");
  expect(summary).toContain("Zip note for the summary.");
  expect(
    forStaff.files
      .get(`${root}/01 Preliminaries/2.0 Site Feature Survey/feature-survey.pdf`)
      ?.subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");

  // A KR admin may see the fee proposal, so its file is in their zip.
  const forAdmin = await download(KR_ADMIN);
  expect(forAdmin.files.has(`${root}/01 Preliminaries/1.0 Fee proposal/fee-proposal.pdf`)).toBe(true);
  expect(forAdmin.files.size).toBe(forStaff.files.size + 1);
});
