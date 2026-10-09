import { expect, test } from "../fixtures";
import { createJob, uniqueJobNumber } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { card, openTracker } from "../support/tracker";

// PRODUCT_SPEC §5 and §6: staff create a job and work its checkpoints.

test("staff create a job from the dashboard, and a duplicate number is refused", async ({ page, signInAs }) => {
  await signInAs(STAFF);
  const jobNumber = uniqueJobNumber();
  await page.goto("/");
  await page.getByRole("button", { name: "New job" }).click();

  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText("Enter the job number.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Job number" }).fill(jobNumber);
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText("Enter the address.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Address", exact: true }).fill("7 Example Road, Testville WA 6000");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText("Choose the subdivision type.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Subdivision type" }).selectOption("Survey-Strata");
  await page.getByRole("textbox", { name: "Client (optional)" }).fill("Synthetic Homes Pty Ltd");
  await page.getByRole("button", { name: "Create job" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("combobox", { name: "Job" })).toContainText(jobNumber);
  await expect(page.getByText("0%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("46").first()).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "New job" }).click();
  await page.getByRole("textbox", { name: "Job number" }).fill(jobNumber.toLowerCase());
  await page.getByRole("textbox", { name: "Address", exact: true }).fill("Another address");
  await page.getByRole("combobox", { name: "Subdivision type" }).selectOption("Freehold");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText(`${jobNumber.toLowerCase()} is already in use.`, { exact: true })).toBeVisible();
});

test("staff set statuses and responsibility, and the progress follows and survives a reload", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);

  const survey = card(page, "i2_0");
  await survey.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(survey.getByRole("button", { name: "Completed", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2%", { exact: true }).first()).toBeVisible();

  const quote = card(page, "i4_0");
  await quote.getByRole("button", { name: "Not required" }).click();
  await expect(page.getByText("4%", { exact: true }).first()).toBeVisible();
  await survey.getByRole("combobox", { name: "Responsibility for 2.0" }).selectOption("Client");

  await page.reload();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(card(page, "i2_0").getByRole("button", { name: "Completed", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card(page, "i2_0").getByRole("combobox", { name: "Responsibility for 2.0" })).toHaveValue("client");
  await expect(card(page, "i4_0").getByRole("button", { name: "Not required" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("4%", { exact: true }).first()).toBeVisible();
});
