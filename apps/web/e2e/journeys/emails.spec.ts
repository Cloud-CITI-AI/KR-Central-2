import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { makeMsg } from "../../../../services/worker/test/msg";
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
  // The parsed text rendering (§10.3): header block, a rule, the body; never the raw MIME source.
  await expect(viewer.getByText("Query about lot 12 boundaries", { exact: true })).toBeVisible();
  await expect(viewer.locator("dt")).toHaveText(["Subject", "From", "To", "Date"]);
  await expect(viewer.locator("pre")).toContainText("Please confirm the boundary dimensions for lot 12.");
  await expect(viewer).not.toContainText("Content-Type");
  await expect(viewer).not.toContainText("Message-ID");
  // The original stays one click away, and "Open in new tab" is styled like Close (ink colour, not a browser-default link).
  await expect(viewer.getByRole("link", { name: "Download original" })).toHaveAttribute(
    "href",
    /\/content\?disposition=attachment$/,
  );
  const colour = (name: string, role: "link" | "button") =>
    viewer.getByRole(role, { name, exact: true }).evaluate((el) => getComputedStyle(el).color);
  expect(await colour("Download original", "link")).toBe(await colour("Close", "button"));
  await page.keyboard.press("Escape");

  // An Outlook .msg is read the same way: its parsed body, and the original to download.
  await fileInput(queries).setInputFiles({
    name: "query-lot-9.msg",
    mimeType: "application/vnd.ms-outlook",
    buffer: makeMsg({
      subject: "Query about lot 9 drainage",
      body: "Plain version café continued",
      to: "office@example.test",
    }),
  });
  const msgRow = queries.getByRole("listitem").filter({ hasText: "Query about lot 9 drainage" });
  await expect(msgRow.getByRole("button", { name: "Query about lot 9 drainage", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await msgRow.getByRole("button", { name: "Query about lot 9 drainage", exact: true }).click();
  const msgViewer = page.getByRole("dialog", { name: "query-lot-9.msg" });
  await expect(msgViewer.locator("pre")).toContainText("Plain version café continued");
  await expect(msgViewer).not.toContainText("can't be previewed");
  await expect(msgViewer.getByRole("link", { name: "Download original" })).toBeVisible();
  await page.keyboard.press("Escape");
  await msgRow.getByRole("button", { name: "Remove Query about lot 9 drainage" }).click();
  await msgRow.getByRole("button", { name: "Yes" }).click();
  await expect(queries.getByText("1 email", { exact: true })).toBeVisible();

  // Text dropped without files is a pasted email: the subject is the first line.
  await queries.locator("label").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "RE: Lot 3 stormwater\nThe commission asks for revised drainage details.");
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  const pasted = queries.getByRole("listitem").filter({ hasText: "RE: Lot 3 stormwater" });
  await expect(pasted).toContainText("Pasted text");
  await pasted.getByRole("button", { name: "RE: Lot 3 stormwater", exact: true }).click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "The commission asks for revised drainage details.",
  );
  await page.keyboard.press("Escape");
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
