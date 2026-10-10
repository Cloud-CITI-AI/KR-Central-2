import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { signInOverHttp } from "../harness/api-client";
import { FIRST_MEMBER, KR_ADMIN, STAFF } from "../harness/users";
import { signInThroughBrowser } from "../support/browser";

// PRODUCT_SPEC §9.1 (users) and §9.2 (audit trail): the admin changes a role or disables a user and that person is signed out
// at once; the audit trail records what happened.

test("an admin changes a role after a confirmation, and the user's session is revoked", async ({
  page,
  signInAs,
  apiAs,
  newUser,
  stack,
}) => {
  const member = await newUser("staff", "promotee");
  const before = await apiAs(member);
  expect((await before.request("GET", "/v1/me")).status).toBe(200);
  await signInAs(FIRST_MEMBER);
  await page.goto("/admin/users");

  const users = page.getByRole("region", { name: "Users" });
  await users.getByRole("searchbox", { name: "Search users" }).fill(member.name);
  const row = users.getByRole("row", { name: member.name });
  await expect(row).toContainText("Staff");
  await row.getByRole("combobox", { name: `Role for ${member.name}` }).selectOption({ label: "KR Admin" });
  const confirm = page.getByRole("dialog", { name: "Change role" });
  await expect(confirm).toContainText(
    `Change ${member.name} from Staff to KR Admin? They are signed out and sign in again with the new role.`,
  );
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("Staff");

  await row.getByRole("combobox", { name: `Role for ${member.name}` }).selectOption({ label: "KR Admin" });
  await page.getByRole("dialog", { name: "Change role" }).getByRole("button", { name: "Change role" }).click();
  await expect(page.getByText(`${member.name} updated.`)).toBeVisible();
  await expect(row).toContainText("KR Admin");

  // The old session no longer works; a new sign-in carries the new role.
  expect((await before.request("GET", "/v1/me")).status).toBe(401);
  const after = await signInOverHttp(stack, member);
  expect((await after.get<{ user: { role: string } }>("/v1/me")).user.role).toBe("kr_admin");

  // Your own row cannot be changed.
  await users.getByRole("searchbox", { name: "Search users" }).fill(FIRST_MEMBER.name);
  await expect(users.getByText("Your own role and status can't be changed.")).toBeVisible();
});

test("a disabled user is signed out and cannot sign in until enabled again", async ({
  page,
  browser,
  signInAs,
  apiAs,
  newUser,
}) => {
  const member = await newUser("staff", "leaver");
  const session = await apiAs(member);
  await signInAs(FIRST_MEMBER);
  await page.goto("/admin/users");
  const users = page.getByRole("region", { name: "Users" });
  await users.getByRole("searchbox", { name: "Search users" }).fill(member.name);
  const row = users.getByRole("row", { name: member.name });
  await row.getByRole("button", { name: `Disable ${member.name}` }).click();
  await page.getByRole("dialog", { name: "Disable user" }).getByRole("button", { name: "Disable" }).click();
  await expect(row).toContainText("Disabled");
  expect((await session.request("GET", "/v1/me")).status).toBe(401);

  const context = await browser.newContext();
  const tab = await context.newPage();
  await signInThroughBrowser(tab, member);
  await expect(tab).toHaveURL(/\/sign-in-error\?reason=disabled/);
  await expect(tab.getByText("Your account has been disabled – contact KR Surveys.")).toBeVisible();

  await row.getByRole("button", { name: `Enable ${member.name}` }).click();
  await page.getByRole("dialog", { name: "Enable user" }).getByRole("button", { name: "Enable" }).click();
  await expect(row).toContainText("Active");
  // A fresh browser: the one above still holds the identity provider's session from the refused attempt.
  await context.close();
  const again = await browser.newContext();
  const retry = await again.newPage();
  await signInThroughBrowser(retry, member);
  await expect(retry.getByRole("heading", { name: "Subdivision dashboard" })).toBeVisible();
  await again.close();
});

test("staff and clients have no admin pages; a KR admin sees the audit trail but not the users", async ({
  page,
  signInAs,
  browser,
}) => {
  await signInAs(STAFF);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  const context = await browser.newContext();
  await signInAs(KR_ADMIN, context);
  const tab = await context.newPage();
  await tab.goto("/");
  await expect(tab.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/audit");
  await tab.goto("/admin/users");
  await expect(tab.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await context.close();
});

test("the audit trail shows who did what to a job, newest first, and can be filtered", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  await staff.patch(
    `/v1/jobs/${job.id}/checkpoints/i2_0`,
    { status: "completed" },
    `"${job.checkpoints.find((c) => c.key === "i2_0")?.version.toString() ?? "1"}"`,
  );
  await staff.post(`/v1/jobs/${job.id}/notes`, { body: "Audit me.", audience: "all" });

  await signInAs(KR_ADMIN);
  await page.goto("/admin/audit");
  const audit = page.getByRole("region", { name: "Audit trail" });
  await audit.getByRole("combobox", { name: "Job" }).fill(job.jobNumber);
  const rows = audit.getByRole("row");
  // header + job.created + checkpoint.status_changed + note.created, newest first
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText("note.created");
  // The Job column names the job by its number (§9.2), as a link in the accent colour, not the browser's blue.
  const jobLink = rows.nth(1).getByRole("link", { name: `Open job ${job.jobNumber}` });
  await expect(jobLink).toHaveText(job.jobNumber);
  await expect(jobLink).toHaveAttribute("href", `/jobs/${job.id}`);
  expect(await jobLink.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(0, 0, 238)");
  await expect(rows.nth(2)).toContainText("checkpoint.status_changed");
  await expect(rows.nth(2)).toContainText(STAFF.name);
  await expect(rows.nth(2)).toContainText("completed");
  await expect(rows.nth(3)).toContainText("job.created");
  await expect(audit.getByText("3 events")).toBeVisible();

  await audit.getByRole("textbox", { name: "Action" }).fill("checkpoint.");
  await expect(rows).toHaveCount(2);
  await expect(audit.getByText("1 event", { exact: true })).toBeVisible();
  await audit.getByRole("textbox", { name: "Action" }).fill("no.such.action");
  await expect(audit.getByText("No events match. Try different filters.")).toBeVisible();
});

test("the first admin's own sign-in is in the trail", async ({ page, signInAs }) => {
  await signInAs(FIRST_MEMBER);
  await page.goto("/admin/audit");
  const audit = page.getByRole("region", { name: "Audit trail" });
  await audit.getByRole("textbox", { name: "Action" }).fill("user.first_admin_assigned");
  await expect(audit.getByRole("row").nth(1)).toContainText(FIRST_MEMBER.name);
});

test("the admin pages link back out: Dashboard, the logo, and tabs styled like the rest of the header", async ({
  page,
  signInAs,
}) => {
  await signInAs(FIRST_MEMBER);
  await page.goto("/admin/users");
  const colour = (locator: ReturnType<typeof page.locator>) => locator.evaluate((el) => getComputedStyle(el).color);

  const admin = page.getByRole("navigation", { name: "Administration" });
  const ink = await colour(page.getByRole("heading", { level: 2, name: "Users" }));
  for (const tab of [admin.getByRole("link", { name: "Users" }), admin.getByRole("link", { name: "Audit trail" })]) {
    const tabColour = await colour(tab);
    expect(tabColour).not.toBe("rgb(0, 0, 238)");
    expect(tabColour).not.toBe("rgb(158, 158, 255)");
  }
  expect(await colour(admin.getByRole("link", { name: "Audit trail" }))).toBe(ink);

  // The logo is a link home with a name, in the tab order.
  const logo = page.getByRole("link", { name: "KR Surveys home" });
  await expect(logo).toHaveAttribute("href", "/");
  await logo.focus();
  await expect(logo).toBeFocused();

  await page.getByRole("link", { name: "Audit trail" }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 2, name: "Subdivision dashboard" })).toBeVisible();
  await page.goto("/admin/users");
  await logo.click();
  await expect(page).toHaveURL(/\/$/);
});
