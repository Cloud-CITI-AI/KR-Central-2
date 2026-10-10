import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { decisionLetter } from "../support/documents";
import { card, openTracker } from "../support/tracker";

// The tracker's structure for a screen reader (PRODUCT_SPEC §12, WCAG 1.3.1 and 2.4.6), in a real browser.

test("the expanded tracker's outline is stages (h2) then checkpoints (h3), and evidence inputs are told apart", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const letter = await decisionLetter("Decision Letter.pdf", [
    { text: "Underground power being provided to every lot.", agency: "Western Power" },
    { text: "Drainage plans being approved.", agency: "City of Stirling" },
    { text: "Water services being provided.", agency: "Water Corporation" },
    { text: "A notification being placed on the titles.", agency: "WAPC" },
  ]);
  await staff.upload(
    job.id,
    { checkpointKey: "i5_0", slot: "decision" },
    { name: letter.name, bytes: letter.buffer, type: letter.mimeType },
  );
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const approval = card(page, "i5_0");
  await approval.getByRole("button", { name: "Extract conditions from Decision Letter" }).click();
  await expect(approval.getByText("4 conditions extracted")).toBeVisible();

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const stageHeadings = page.locator("section[id] > h2");
  await expect(stageHeadings).toHaveCount(10);
  await expect(stageHeadings.first()).toHaveText(/Preliminaries/i);
  await expect(stageHeadings.first().getByRole("button", { expanded: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Subdivision progress/i })).toBeVisible();
  // every checkpoint card of an open stage is an h3 under it (a stage without conditions in the letter is not open)
  const cards = await page.locator("[data-checkpoint]").count();
  expect(cards).toBeGreaterThanOrEqual(40);
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(cards);

  // Each condition has its own evidence input name (a condition shows in the checklist and in its agency's box: two inputs each).
  const names = await page.locator('input[type="file"]').evaluateAll((inputs) =>
    inputs
      .map((input) => [...((input as HTMLInputElement).labels ?? [])].map((l) => l.textContent).join(" "))
      .filter((name) => name.includes("clearance evidence"))
      .map((name) => name.replace(/\s+/g, " ")),
  );
  expect(names.length).toBeGreaterThanOrEqual(4);
  for (const number of [1, 2, 3, 4])
    expect(names.some((name) => name.includes(`(condition ${number.toString()})`))).toBe(true);
  expect(new Set(names).size).toBeGreaterThanOrEqual(4);
});
