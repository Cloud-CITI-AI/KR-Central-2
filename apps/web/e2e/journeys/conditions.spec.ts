import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { decisionLetter, pdfFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// PRODUCT_SPEC §5.5 (conditions), §5.6 (condition card), §8 R1 (agency exclusion), §10.2 (Decision Letter extraction):
// a synthetic letter goes through the real API, S3 mock and worker.

const CONDITIONS = [
  { text: "Drainage plans being submitted to and approved by the City of Stirling.", agency: "City of Stirling" },
  { text: "Underground power being provided to every lot.", agency: "Western Power" },
  { text: "The crossover and verge being reinstated." },
  { text: "A notification being placed on the title.", agency: "Western Australian Planning Commission" },
] as const;

test("a Decision Letter fills the checklist, excludes the agency stages it does not name, and edits show in both places", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const approval = card(page, "i5_0");

  // A PDF without "decision" in its name cannot be read.
  await fileInput(approval).setInputFiles(await pdfFile("approval-scan.pdf", [["Not a letter"]]));
  await expect(
    approval.getByText(
      'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.',
    ),
  ).toBeVisible();

  await fileInput(approval).setInputFiles(await decisionLetter("Decision Letter.pdf", CONDITIONS));
  await approval.getByRole("button", { name: "Extract conditions from Decision Letter" }).click();
  await expect(approval.getByText("4 conditions extracted")).toBeVisible();
  await expect(
    approval.getByText("Check the agency for condition 3 – no agency was named in brackets, so it was guessed."),
  ).toBeVisible();
  await expect(approval.getByText("0 of 4 cleared")).toBeVisible();
  await expect(approval.getByText("Extracted from Decision Letter.pdf", { exact: false })).toBeVisible();

  // The letter's dates reach the summary panel.
  await expect(page.getByLabel("WAPC approval date")).toHaveValue("2026-03-12");
  await expect(page.getByLabel("Approval expiry")).toHaveValue("2028-03-12");
  await expect(page.getByText(/\d+ days left to lodge Form 1C/)).toBeVisible();

  // Agencies the letter does not name are excluded: Not required, disabled, and they cannot be opened.
  for (const agency of ["Water Corporation", "Busselton Water"]) {
    const bar = page.getByTitle(`The Decision Letter has no conditions for ${agency}`);
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Not required");
    await expect(page.getByRole("button", { name: agency })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /^Western Power/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Local Government/ })).toBeVisible();

  // An edit in the checklist shows in the agency stage at once, and the other way round.
  const checklist = approval.getByRole("group", { name: "Condition 2", exact: true });
  const inAgency = page.getByRole("group", { name: "Condition 2 – Western Power" });
  await checklist.getByRole("checkbox", { name: /Condition 2/ }).click();
  await expect(checklist.getByRole("checkbox", { name: /Condition 2/ })).toBeChecked();
  await expect(approval.getByText("1 of 4 cleared")).toBeVisible();
  await expect(inAgency.getByText("Cleared")).toBeVisible();
  await expect(page.getByRole("group", { name: "WAPC conditions – Western Power" })).toContainText("1 of 1 cleared");
  await inAgency
    .getByRole("textbox", { name: "KR Surveys comment – condition 2" })
    .fill("Design submitted to Western Power");
  await inAgency.getByRole("textbox", { name: "Client comment – condition 2" }).fill("Lot owners notified");
  await inAgency.getByRole("textbox", { name: "Client comment – condition 2" }).blur();
  await expect(checklist.getByRole("textbox", { name: "KR Surveys comment – condition 2" })).toHaveValue(
    "Design submitted to Western Power",
  );
  await page.reload();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(
    page
      .getByRole("group", { name: "Condition 2", exact: true })
      .getByRole("textbox", { name: "Client comment – condition 2" }),
  ).toHaveValue("Lot owners notified");

  // A guessed agency is flagged until someone confirms it; moving a condition to an agency brings that stage back.
  const guessed = card(page, "i5_0").getByRole("group", { name: "Condition 3", exact: true });
  await expect(guessed.getByText("Agency guessed – please check")).toBeVisible();
  await guessed.getByRole("combobox", { name: "Agency for condition 3" }).selectOption("Water Corporation");
  await expect(guessed.getByText("Agency guessed – please check")).toHaveCount(0);
  await expect(page.getByTitle("The Decision Letter has no conditions for Water Corporation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Water Corporation/ })).toBeVisible();
});

test("extracting again asks before replacing the conditions, ticks and comments", async ({ page, signInAs, apiAs }) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const approval = card(page, "i5_0");
  await fileInput(approval).setInputFiles(await decisionLetter("Decision Letter.pdf", CONDITIONS));
  await approval.getByRole("button", { name: "Extract conditions from Decision Letter" }).click();
  await expect(approval.getByText("0 of 4 cleared")).toBeVisible();
  await approval.getByRole("checkbox", { name: /Condition 1/ }).click();
  await expect(approval.getByText("1 of 4 cleared")).toBeVisible();

  await approval.getByRole("button", { name: "Re-extract conditions from Decision Letter" }).click();
  await expect(
    approval.getByText("Replace the 4 existing conditions, including their ticks, comments and evidence?"),
  ).toBeVisible();
  await approval.getByRole("button", { name: "Cancel" }).click();
  await expect(approval.getByText("1 of 4 cleared")).toBeVisible();

  await approval.getByRole("button", { name: "Re-extract conditions from Decision Letter" }).click();
  await approval.getByRole("button", { name: "Replace" }).click();
  await expect(approval.getByText("0 of 4 cleared")).toBeVisible();
});
