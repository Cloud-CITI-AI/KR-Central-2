import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";

// PRODUCT_SPEC §5.7: job notes, newest first, with an audience label and a Delete? confirmation.

test("staff add notes with an audience label, see them newest first and delete one", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);
  const notes = page.getByRole("region", { name: "Job notes" });
  await expect(notes.getByText("Any notes relevant to the subdivision. Any party can post a note.")).toBeVisible();
  await expect(notes.getByText("No notes on this job yet.")).toBeVisible();

  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("Type a note first.")).toBeVisible();

  await notes.getByRole("textbox", { name: "New job note" }).fill("Survey pegs placed on lots 1 to 4.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("Survey pegs placed on lots 1 to 4.")).toBeVisible();
  await expect(notes.getByText("No notes on this job yet.")).toHaveCount(0);

  await notes.getByRole("textbox", { name: "New job note" }).fill("Client asked for the plan by Friday.");
  await notes.getByRole("combobox", { name: "Note is for" }).selectOption({ label: "For: Client" });
  await notes.getByRole("button", { name: "Add note" }).click();
  const items = notes.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Client asked for the plan by Friday.");
  await expect(items.first()).toContainText("For client");
  await expect(items.first()).toContainText("by you");
  await expect(items.last()).toContainText("For everyone");

  await page.reload();
  await expect(notes.getByRole("listitem")).toHaveCount(2);

  await items.first().getByRole("button", { name: "Delete note" }).click();
  await expect(items.first().getByText("Delete?")).toBeVisible();
  await items.first().getByRole("button", { name: "No" }).click();
  await expect(items).toHaveCount(2);
  await items.first().getByRole("button", { name: "Delete note" }).click();
  await items.first().getByRole("button", { name: "Yes" }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Survey pegs placed on lots 1 to 4.");
});
