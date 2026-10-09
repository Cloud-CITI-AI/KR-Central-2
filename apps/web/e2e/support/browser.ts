import type { Page } from "@playwright/test";
import type { MockUser } from "@kr/mock-idp";

/** Sign in the way a person does: the sign-in page, the (mock) Microsoft account picker, back to the app. */
export async function signInThroughBrowser(page: Page, user: MockUser, returnTo?: string): Promise<void> {
  await page.goto(returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in");
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: `(${user.email ?? user.preferredUsername})` }).click();
}
