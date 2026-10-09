import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { ARCHITECT_GUEST, STAFF } from "../harness/users";
import { signInThroughBrowser } from "../support/browser";

// PRODUCT_SPEC §3.1: the sign-in flow end to end against the mock Entra, through the real browser, web proxy and API.

test("a signed-out visitor is sent to sign-in and lands on the page they wanted after signing in", async ({
  page,
  apiAs,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  await page.goto(`/jobs/${job.id}`);
  await page.waitForURL((url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === `/jobs/${job.id}`);
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: `(${STAFF.email})` }).click();
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await expect(page.getByRole("combobox", { name: "Job" })).toContainText(job.jobNumber);
  await expect(page.getByText(STAFF.name)).toBeVisible();
});

test("signing in from the sign-in page opens the dashboard", async ({ page }) => {
  await signInThroughBrowser(page, ARCHITECT_GUEST);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Subdivision dashboard" })).toBeVisible();
});

test("cancelling at Microsoft shows the cancelled message, and Try again starts over", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: "Cancel sign-in" }).click();
  await expect(page).toHaveURL(/\/sign-in-error\?reason=cancelled/);
  await expect(page.getByText("Sign-in was cancelled.")).toBeVisible();
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("link", { name: "Sign in with Microsoft" })).toBeVisible();
});

test("an account from another organisation is refused with the wrong-tenant message", async ({ page, newUser }) => {
  const stranger = await newUser("staff", "stranger", { tid: "00000000-0000-4000-8000-0000000000ff" });
  await signInThroughBrowser(page, stranger);
  await expect(page).toHaveURL(/\/sign-in-error\?reason=wrong_tenant/);
  await expect(
    page.getByText(
      "That account isn't part of the KR Surveys organisation – sign in with the account KR Surveys invited.",
    ),
  ).toBeVisible();
});

test("signing out ends the session and the next visit asks for sign-in again", async ({
  page,
  signInAs,
  newUser,
  stack,
}) => {
  // Someone of their own: signing out revokes the session, which must not be one other tests share.
  const leaver = await newUser("staff", "leaver");
  const session = await signInAs(leaver);
  await page.goto("/");
  await expect(page.getByText(leaver.name)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signed-out$/);
  await expect(page.getByRole("heading", { name: "You have signed out" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  // The server revoked the session, not only the browser's cookie.
  const stale = await fetch(`${stack.apiUrl}/v1/me`, { headers: { cookie: `__Host-kr_session=${session.sessionId}` } });
  expect(stale.status).toBe(401);
});
