import { randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { createJob, patchCheckpoint } from "../harness/jobs";
import { STAFF } from "../harness/users";

// PRODUCT_SPEC §6: the dashboard's status filter, search, type chips and summary chips. The stack is shared with other
// journeys, so every job here carries a client name no other test uses and every search is scoped to it.

test("the status filter, search and type chips narrow the cards, and the choices live in the URL", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const staff = await apiAs(STAFF);
  const token = `Zq${randomBytes(3).toString("hex")}`;
  const client = `${token} Holdings`;
  const strata = await createJob(staff, { clientName: client, subdivisionType: "Survey-Strata" });
  const freehold = await createJob(staff, { clientName: client, subdivisionType: "Freehold" });
  const finished = await createJob(staff, { clientName: client, subdivisionType: "Freehold" });
  await patchCheckpoint(staff, finished.id, "i13_2", { status: "completed" });

  await signInAs(STAFF);
  await page.goto(`/?q=${token}`);
  const cards = page.getByRole("article");
  const show = page.getByRole("group", { name: "Show" });
  // In progress is the default filter: the finished job is not listed.
  await expect(cards).toHaveCount(2);
  await expect(show.getByRole("button", { name: /^In progress/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: strata.jobNumber })).toBeVisible();
  await expect(page.getByRole("article", { name: freehold.jobNumber })).toBeVisible();

  await show.getByRole("button", { name: /^Complete/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(finished.jobNumber);
  await expect(cards.first()).toContainText("Complete");
  await expect(cards.first()).toContainText("All done");

  await show.getByRole("button", { name: /^All/ }).click();
  await expect(cards).toHaveCount(3);
  await page
    .getByRole("group", { name: "Subdivision type" })
    .getByRole("button", { name: /^Freehold/ })
    .click();
  await expect(cards).toHaveCount(2);
  await expect(page).toHaveURL(/type=Freehold/);
  // Clicking the active chip clears it.
  await page
    .getByRole("group", { name: "Subdivision type" })
    .getByRole("button", { name: /^Freehold/ })
    .click();
  await expect(cards).toHaveCount(3);

  await page.getByRole("searchbox", { name: "Search jobs" }).fill(strata.jobNumber.toLowerCase());
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(strata.jobNumber);
  await page.getByRole("searchbox", { name: "Search jobs" }).fill("no-such-job-anywhere");
  await expect(page.getByText("No jobs match.")).toBeVisible();

  // The URL is the state: a reload and a deep link land on the same view.
  await page.goto(`/?q=${token}&status=all&type=Freehold`);
  await expect(cards).toHaveCount(2);
  await expect(show.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
});

test("a card shows the next actions and who owns them, and opens the job", async ({ page, signInAs, apiAs }) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff, { clientName: `Zq${randomBytes(3).toString("hex")} Pty Ltd` });
  await signInAs(STAFF);
  await page.goto(`/?q=${job.jobNumber}`);
  const cardEl = page.getByRole("article");
  await expect(cardEl).toHaveCount(1);
  await expect(cardEl.getByText("Next to action")).toBeVisible();
  await expect(cardEl.getByText("Fee proposal")).toBeVisible();
  await expect(cardEl.getByText("Client", { exact: true }).first()).toBeVisible();
  await cardEl.getByRole("link", { name: /Open job/ }).click();
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("link", { name: /Back to tracker/ })).toHaveAttribute("href", `/jobs/${job.id}`);
});
