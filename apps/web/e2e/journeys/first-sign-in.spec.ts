import { expect, isolatedStackTest } from "../fixtures";
import { FIRST_MEMBER, STAFF, EXTERNAL_NO_GRANTS } from "../harness/users";
import { signInThroughBrowser } from "../support/browser";

// ADR-0003, PRODUCT_SPEC §3.3: the first eligible sign-in on a pristine system becomes admin, later ones do not.
// It needs a system nobody has signed in to, so it runs against a stack of its own.
const test = isolatedStackTest({ label: "first-sign-in" });
test.describe.configure({ mode: "serial" });

test("the first KR member to sign in becomes admin and sees the Admin link", async ({ page }) => {
  await signInThroughBrowser(page, FIRST_MEMBER);
  await expect(page.getByRole("heading", { name: "SUBDIVISION DASHBOARD" })).toBeVisible();
  await expect(page.getByText(FIRST_MEMBER.name)).toBeVisible();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  const ada = page.getByRole("row", { name: FIRST_MEMBER.name });
  await expect(ada).toContainText("AdminMember");
});

test("the next KR member is staff, and a guest with no grants is external", async ({ page, browser, own }) => {
  await signInThroughBrowser(page, STAFF);
  await expect(page.getByRole("heading", { name: "SUBDIVISION DASHBOARD" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  const guest = await browser.newContext({ baseURL: own.info.webUrl });
  const guestPage = await guest.newPage();
  await signInThroughBrowser(guestPage, EXTERNAL_NO_GRANTS);
  await expect(
    guestPage.getByText("You don't have access to any jobs yet — ask your KR Surveys contact."),
  ).toBeVisible();
  await guest.close();
});
