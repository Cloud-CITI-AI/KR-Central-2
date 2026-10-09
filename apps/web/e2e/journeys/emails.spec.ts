import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { emlFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// PRODUCT_SPEC §5.5 (emails, 4.3 Queries from WAPC) and §10.3: the worker parses a synthetic .eml; pasted text becomes an email.

test("an .eml file is parsed by the worker and read in the viewer, pasted text is added as an email, other files are refused", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const queries = card(page, "i4_3");
  await expect(queries.getByText("none yet")).toBeVisible();

  await fileInput(queries).setInputFiles(
    emlFile("query-lot-12.eml", {
      subject: "Query about lot 12 boundaries",
      from: "Pat Planner <pat.planner@example.org>",
      body: "Please confirm the boundary dimensions for lot 12.\nThanks, Pat",
    }),
  );
  const row = queries.getByRole("listitem").filter({ hasText: "Query about lot 12 boundaries" });
  // The tracker refreshes its data every 15 s (§14), which is how the parsed subject replaces "Reading the email…".
  await expect(row.getByRole("button", { name: "Query about lot 12 boundaries", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(row).toContainText("Pat Planner");
  await expect(row).toContainText("28 Sep 2026");
  await expect(queries.getByText("1 email", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Query about lot 12 boundaries", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "query-lot-12.eml" });
  await expect(viewer).toContainText("Subject: Query about lot 12 boundaries");
  await expect(viewer).toContainText("Please confirm the boundary dimensions for lot 12.");
  await page.keyboard.press("Escape");

  // Text dropped without files is a pasted email: the subject is the first line.
  await queries.locator("label").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "RE: Lot 3 stormwater\nThe commission asks for revised drainage details.");
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  const pasted = queries.getByRole("listitem").filter({ hasText: "RE: Lot 3 stormwater" });
  await expect(pasted).toContainText("Pasted text");
  await expect(queries.getByText("2 emails", { exact: true })).toBeVisible();

  // Anything that is not .msg or .eml is refused with the emails wording.
  await queries.locator("label").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "site-photo.png", { type: "image/png" }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(
    queries.getByText(
      "site-photo.png isn't an email – drop an Outlook message (.msg) or .eml file, or use Upload for other documents",
    ),
  ).toBeVisible();

  await row.getByRole("button", { name: "Remove Query about lot 12 boundaries" }).click();
  await row.getByRole("button", { name: "Yes" }).click();
  await expect(queries.getByText("1 email", { exact: true })).toBeVisible();
});
