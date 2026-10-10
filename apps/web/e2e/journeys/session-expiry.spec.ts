import { expect, test } from "../fixtures";
import { signInOverHttp } from "../harness/api-client";
import { createJob, getJob } from "../harness/jobs";
import { STAFF } from "../harness/users";

// PRODUCT_SPEC §3.1 ("go to sign-in and come back here") and §15 (comment content is never replaced or lost): when the
// session ends while someone is typing, what they typed survives the trip through sign-in.

const KR_NOTE_LABEL = "KR Surveys comment – what the client needs to pay";
const FIRST_PART = "Synthetic partial comment";
const AFTER_EXPIRY = " plus more typed after expiry…";

test("a KR comment typed after the session ended is back, and saved, after signing in again", async ({
  page,
  signInAs,
  apiAs,
  newUser,
  stack,
}) => {
  const job = await createJob(await apiAs(STAFF));
  // Its own person and session: ending it must not sign out the other journeys that share Sam's.
  const user = await newUser("staff", "expiry-note");
  const session = await signInAs(user);

  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Expand all" }).click();
  const note = page.getByRole("textbox", { name: KR_NOTE_LABEL });
  const firstSave = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/checkpoints/"));
  // The save is followed by a refresh of the job: let it finish, or it would be the request that finds the session gone.
  const refresh = page.waitForResponse(
    (r) => r.request().method() === "GET" && r.url().endsWith(`/api/v1/jobs/${job.id}`),
  );
  await note.fill(FIRST_PART);
  expect((await firstSave).status()).toBe(200);
  expect((await refresh).status()).toBe(200);

  // As an idle timeout or an admin changing the role would: the session ends under the open page.
  await session.post("/v1/auth/logout");

  // One input event, so a slow machine cannot be mid-keystroke when the first refused request sends the page away.
  await note.fill(FIRST_PART + AFTER_EXPIRY);
  await page.waitForURL((url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === `/jobs/${job.id}`);

  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: `(${user.email})` }).click();
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await expect(page.getByText("What you were typing when your session ended has been restored.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: KR_NOTE_LABEL })).toHaveValue(FIRST_PART + AFTER_EXPIRY);

  // The text reached the server, not only the field.
  const fresh = await signInOverHttp(stack, user);
  await expect
    .poll(async () => (await getJob(fresh, job.id)).checkpoints.find((c) => c.krNote !== "")?.krNote)
    .toBe(FIRST_PART + AFTER_EXPIRY);
});

test("a job note written before the session ended is back in the box after signing in again", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const job = await createJob(await apiAs(STAFF));
  const user = await newUser("staff", "expiry-job-note");
  const session = await signInAs(user);
  const note = "Synthetic note: pegs placed on lots 1 to 4.";

  await page.goto(`/jobs/${job.id}`);
  const notes = page.getByRole("region", { name: "Job notes" });
  await notes.getByRole("textbox", { name: "New job note" }).fill(note);

  await session.post("/v1/auth/logout");
  await notes.getByRole("button", { name: "Add note" }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === `/jobs/${job.id}`);

  await page.getByRole("link", { name: "Sign in with Microsoft" }).click();
  await page.getByRole("link", { name: `(${user.email})` }).click();
  await expect(page).toHaveURL(`/jobs/${job.id}`);
  await expect(notes.getByRole("textbox", { name: "New job note" })).toHaveValue(note);
  await expect(page.getByText("What you were typing when your session ended has been restored.")).toBeVisible();

  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByRole("listitem")).toContainText(note);
});
