import { expect, test } from "../fixtures";
import { createJob, grantAccess } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { signInThroughBrowser } from "../support/browser";

// PRODUCT_SPEC §3.4 and §6 (access manager): staff grant a client access, the grant is pending until the guest signs in with that
// email, then active and bound to them; removing it takes effect on the guest's next request.

test("staff grant a client access; it is pending until the guest signs in, then active; removing it ends the access", async ({
  page,
  browser,
  signInAs,
  apiAs,
  newUser,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const other = await createJob(staff);
  const guest = await newUser("guest", "grantee");
  const email = guest.email!;
  await signInAs(STAFF);
  await page.goto("/");
  const manager = page.getByRole("region", { name: "Access manager" });
  await expect(manager.getByText("KR Surveys staff see all jobs automatically.", { exact: false })).toBeVisible();
  await expect(
    manager.getByText("KR Surveys IT must also invite them as a guest in Microsoft Entra before they can sign in."),
  ).toBeVisible();

  await manager.getByRole("button", { name: "Grant access" }).click();
  await expect(manager.getByText("Enter a valid email address, e.g. name@example.com.")).toBeVisible();
  await manager.getByRole("textbox", { name: "Email address" }).fill(email);
  await manager.getByRole("button", { name: "Grant access" }).click();
  await expect(manager.getByText("Choose which job they should see.")).toBeVisible();
  await manager.getByRole("combobox", { name: "Job" }).selectOption(job.id);
  await manager.getByRole("textbox", { name: "Name" }).fill("Grace Grantee");
  await manager.getByRole("button", { name: "Grant access" }).click();
  await expect(manager.getByText(`${email} added – they get access when they sign in with that email.`)).toBeVisible();
  const row = manager.getByRole("listitem").filter({ hasText: email });
  await expect(row).toContainText("Grace Grantee");
  await expect(row).toContainText(job.jobNumber);
  await expect(row).toContainText("Client");
  await expect(row).toContainText("Pending");

  await manager.getByRole("textbox", { name: "Email address" }).fill(email);
  await manager.getByRole("combobox", { name: "Job" }).selectOption(job.id);
  await manager.getByRole("button", { name: "Grant access" }).click();
  await expect(manager.getByText(`${email} is already on the list for ${job.jobNumber}.`)).toBeVisible();

  // The guest signs in with that email: the grant becomes theirs, and they see that job and no other.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await signInThroughBrowser(guestPage, guest);
  await expect(guestPage.getByRole("article")).toHaveCount(1);
  await expect(guestPage.getByRole("article", { name: job.jobNumber })).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "New job" })).toHaveCount(0);
  await expect(guestPage.getByRole("region", { name: "Access manager" })).toHaveCount(0);
  await guestPage.goto(`/jobs/${other.id}`);
  await expect(guestPage.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await page.reload();
  await expect(row).toContainText("Active");

  // Remove: the guest's next request no longer sees the job.
  await row.getByRole("button", { name: "Remove" }).click();
  await row.getByRole("button", { name: "Yes" }).click();
  await expect(row).toContainText("Revoked");
  await guestPage.goto("/");
  await expect(
    guestPage.getByText("You don't have access to any jobs yet — ask your KR Surveys contact."),
  ).toBeVisible();

  // A revoked grant can be granted again (here as an architect); the same account sees the job once more.
  await grantAccess(staff, { jobId: job.id, email, role: "architect" });
  await guestPage.goto("/");
  await expect(guestPage.getByRole("article", { name: job.jobNumber })).toBeVisible();
  await guestContext.close();
});
