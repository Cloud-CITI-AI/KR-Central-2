import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createJob, getJob, grantAccess, patchCheckpoint } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { card, openTracker } from "../support/tracker";

// PRODUCT_SPEC §14 (If-Match, 412 reloads and says so), §3.1 ("go to sign-in and come back here") and §15 (typed content is
// never replaced or lost): what two people type at once, and what is typed when the session ends, is never dropped silently.

const KR_NOTE_LABEL = "KR Surveys comment – what the client needs to pay";
const RESTORED = "What you were typing when your session ended has been restored.";
const STALE = "Someone else changed this — the latest version has been loaded.";

/** Back through the mock Microsoft account picker after a session ended (`returnTo` was set by the redirect). */
async function signBackIn(page: Page, email: string | null | undefined) {
  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: `(${email ?? ""})` }).click();
}

test("a KR comment typed over someone else's refreshed one answers 412 with the banner, and their text stays (§14, §15)", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const sam = await apiAs(STAFF);
  const job = await createJob(sam);
  const cleo = await newUser("staff", "cleo-kr-note");
  await signInAs(cleo);
  // The background refresh is 15 s: a fake clock runs it without the wait.
  await page.clock.install();
  await openTracker(page, job.id);

  const note = page.getByRole("textbox", { name: KR_NOTE_LABEL });
  const firstSave = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/checkpoints/"));
  await note.click();
  await note.pressSequentially("abc");
  await page.clock.runFor(900); // the 700 ms autosave
  expect((await firstSave).status()).toBe(200);

  // Sam saves the same note meanwhile (version 3), and the field keeps focus while the refresh brings it in.
  await patchCheckpoint(sam, job.id, "i8_3", { krNote: "Sam's note" });
  const refresh = page.waitForResponse(
    (r) => r.request().method() === "GET" && r.url().endsWith(`/api/v1/jobs/${job.id}`),
  );
  await page.clock.runFor(16_000);
  expect((await refresh).status()).toBe(200);
  await expect(note).toBeFocused();
  await expect(note).toHaveValue("abc");

  await note.pressSequentially("def");
  await page.clock.runFor(900);
  await expect(page.getByText(STALE)).toBeVisible();
  // Sam's text was not overwritten, and what Cleo typed is still in her box.
  const stored = (await getJob(sam, job.id)).checkpoints.find((c) => c.key === "i8_3");
  expect(stored?.krNote).toBe("Sam's note");
  await expect(note).toHaveValue("abcdef");
});

test("a decline comment typed when the session ended is back, in its form, after signing in again (§3.1, §15)", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const client = await newUser("guest", "expiry-decline");
  await grantAccess(staff, { jobId: job.id, email: client.email!, role: "client", displayName: client.name });
  const session = await signInAs(client);

  await openTracker(page, job.id);
  const proposal = card(page, "i3_0p");
  await proposal.getByRole("button", { name: "Decline WAPC proposal" }).click();
  await proposal.getByRole("textbox").fill("The fee is higher than quoted.");
  await session.post("/v1/auth/logout");
  await proposal.getByRole("button", { name: "Confirm decline" }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === `/jobs/${job.id}`);

  await signBackIn(page, client.email);
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await expect(page.getByText(RESTORED)).toBeVisible();
  const restored = card(page, "i3_0p");
  await expect(restored.getByRole("textbox")).toHaveValue("The fee is higher than quoted.");
  await restored.getByRole("button", { name: "Confirm decline" }).click();
  await expect(restored.getByText("Client declined the WAPC proposal")).toBeVisible();
});

test("an EDIT JOB change saved after the session ended reopens the dialog with it after signing in again (§3.1, §15)", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const job = await createJob(await apiAs(STAFF));
  const user = await newUser("staff", "expiry-edit-job");
  const session = await signInAs(user);

  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "EDIT JOB" }).click();
  const dialog = page.getByRole("dialog", { name: "Job details" });
  await dialog.getByLabel("Address").fill("77 Replacement Road, Testville WA 6000");
  await session.post("/v1/auth/logout");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === `/jobs/${job.id}`);

  await signBackIn(page, user.email);
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await expect(page.getByText(RESTORED)).toBeVisible();
  const reopened = page.getByRole("dialog", { name: "Job details" });
  await expect(reopened.getByLabel("Address")).toHaveValue("77 Replacement Road, Testville WA 6000");
  await reopened.getByRole("button", { name: "Save" }).click();
  await expect(reopened).toBeHidden();
  await expect
    .poll(async () => (await getJob(await apiAs(STAFF), job.id)).address)
    .toBe("77 Replacement Road, Testville WA 6000");
});

test("a NEW JOB form left idle past the dashboard's refresh comes back filled in after signing in again (§3.1, §15)", async ({
  page,
  signInAs,
  newUser,
}) => {
  const user = await newUser("staff", "expiry-new-job");
  const session = await signInAs(user);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "New job" }).click();
  await page.getByRole("textbox", { name: "Job number" }).fill("EXP-0042");
  await page.getByRole("textbox", { name: "Address", exact: true }).fill("5 Synthetic Way, Testville WA 6000");
  await page.getByRole("textbox", { name: "Client (optional)" }).fill("Expiry Developments");
  await page.getByRole("combobox", { name: "Subdivision type" }).selectOption("Freehold");

  await session.post("/v1/auth/logout");
  await page.clock.runFor(17_000); // the dashboard's background refresh finds the session gone
  await page.waitForURL((url) => url.pathname === "/sign-in");

  await signBackIn(page, user.email);
  await expect(page).toHaveURL("/");
  await expect(page.getByText(RESTORED)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Job number" })).toHaveValue("EXP-0042");
  await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(
    "5 Synthetic Way, Testville WA 6000",
  );
  await expect(page.getByRole("textbox", { name: "Client (optional)" })).toHaveValue("Expiry Developments");
  await expect(page.getByRole("combobox", { name: "Subdivision type" })).toHaveValue("Freehold");
});

test("the access form keeps what was typed when the session ended and puts it back after signing in again (§3.1, §15)", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const job = await createJob(await apiAs(STAFF));
  const user = await newUser("staff", "expiry-access");
  const session = await signInAs(user);
  await page.goto("/");
  const manager = page.getByRole("region", { name: "Access manager" });
  // The job picker is filled from the API once the page is hydrated: typing earlier would be wiped by hydration.
  await expect(manager.getByRole("option", { name: job.jobNumber })).toBeAttached();
  await manager.getByRole("textbox", { name: "Email address" }).fill("grantee.expiry@example.com");
  await manager.getByRole("textbox", { name: "Name" }).fill("Grace Grantee");
  await manager.getByRole("combobox", { name: "Role" }).selectOption("architect");
  await manager.getByRole("combobox", { name: "Job" }).selectOption(job.id);
  await session.post("/v1/auth/logout");
  await manager.getByRole("button", { name: "Grant access" }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in");

  await signBackIn(page, user.email);
  await expect(page).toHaveURL("/");
  await expect(page.getByText(RESTORED)).toBeVisible();
  const restored = page.getByRole("region", { name: "Access manager" });
  await expect(restored.getByRole("textbox", { name: "Email address" })).toHaveValue("grantee.expiry@example.com");
  await expect(restored.getByRole("textbox", { name: "Name" })).toHaveValue("Grace Grantee");
  await expect(restored.getByRole("combobox", { name: "Role" })).toHaveValue("architect");
  await expect(restored.getByRole("combobox", { name: "Job" })).toHaveValue(job.id);
});
