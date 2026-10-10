import { expect, test } from "../fixtures";
import { createJob, grantAccess } from "../harness/jobs";
import { KR_ADMIN, STAFF } from "../harness/users";
import { pdfFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";

// PRODUCT_SPEC §2.1 (permissions), §5.4 (restricted fee proposal), §5.5 (approval panel, slots) and §5.7 (notes) for the people
// who are not KR staff: a client who may decide and upload, an architect who may only look and comment.

test("a client sees only the granted job, accepts a quote, uploads the signed consent letter and posts a note", async ({
  page,
  signInAs,
  apiAs,
  newUser,
}) => {
  const staff = await apiAs(STAFF);
  const job = await createJob(staff, { clientName: "Cleo's Developments" });
  const unrelated = await createJob(staff);
  const client = await newUser("guest", "cleo");
  await grantAccess(staff, { jobId: job.id, email: client.email!, role: "client", displayName: client.name });
  await signInAs(client);

  // Only the granted job, and none of the staff tools.
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: job.jobNumber })).toBeVisible();
  await expect(page.getByRole("button", { name: "New job" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Access manager" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto(`/jobs/${unrelated.id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await openTracker(page, job.id);
  await expect(page.getByRole("button", { name: "EDIT JOB" })).toHaveCount(0);
  await expect(page.getByText("You have view-only access to this tracker, so changes can't be saved.")).toHaveCount(0);
  // The status and responsibility controls are there but disabled for a client.
  const survey = card(page, "i2_0");
  await expect(survey.getByRole("button", { name: "Completed", exact: true })).toBeDisabled();
  await expect(survey.getByRole("combobox", { name: "Responsibility for 2.0" })).toBeDisabled();
  await expect(fileInput(survey)).toHaveCount(0);

  // Accept the Western Power quote (6.1): the decision is recorded and the status is left to staff.
  const quote = card(page, "i6_1a");
  await quote.getByRole("button", { name: "Accept quote" }).click();
  await quote.getByRole("textbox").fill("Happy to proceed.");
  await quote.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(quote.getByText("Client accepted the quote")).toBeVisible();
  await expect(quote.getByText("“Happy to proceed.”")).toBeVisible();
  await expect(quote.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");

  // Declining needs a reason.
  const proposal = card(page, "i3_0p");
  await proposal.getByRole("button", { name: "Decline WAPC proposal" }).click();
  await proposal.getByRole("button", { name: "Confirm decline" }).click();
  await expect(proposal.getByText("Add a comment explaining why the WAPC proposal is declined.")).toBeVisible();
  await proposal.getByRole("button", { name: "Cancel" }).click();

  // A staff-and-client slot takes the client's upload; they can remove their own file.
  await fileInput(proposal).setInputFiles(await pdfFile("signed-letter-of-consent.pdf"));
  await expect(proposal.getByRole("button", { name: "signed-letter-of-consent.pdf", exact: true })).toBeVisible();
  await proposal.getByRole("button", { name: "Remove signed-letter-of-consent.pdf" }).click();
  await proposal.getByRole("button", { name: "Yes" }).click();
  await expect(proposal.getByRole("button", { name: "signed-letter-of-consent.pdf", exact: true })).toHaveCount(0);

  // The client posts a note; staff see it under the client's name.
  const notes = page.getByRole("region", { name: "Job notes" });
  await notes.getByRole("textbox", { name: "New job note" }).fill("Please call me about lot 2.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByRole("listitem").first()).toContainText("by you");
  const stored = await staff.get<{ items: { body: string; author: { displayName: string } | null }[] }>(
    `/v1/jobs/${job.id}/notes`,
  );
  expect(stored).toMatchObject({
    items: [{ body: "Please call me about lot 2.", author: { displayName: client.name } }],
  });
});

test("the fee proposal is shown to the client, and hidden from an architect and from staff", async ({
  page,
  browser,
  signInAs,
  apiAs,
  newUser,
}) => {
  const staff = await apiAs(STAFF);
  const admin = await apiAs(KR_ADMIN);
  const job = await createJob(staff);
  const proposal = await pdfFile("fee-proposal.pdf");
  await admin.upload(
    job.id,
    { checkpointKey: "i1_0p", slot: "documents" },
    { name: proposal.name, bytes: proposal.buffer, type: proposal.mimeType },
  );
  const client = await newUser("guest", "client");
  const architect = await newUser("guest", "architect");
  await grantAccess(staff, { jobId: job.id, email: client.email!, role: "client" });
  await grantAccess(staff, { jobId: job.id, email: architect.email!, role: "architect" });

  const restricted = "Fee proposal details are visible to KR Admin and the client only.";
  const people = [
    { who: client, sees: true },
    { who: architect, sees: false },
    { who: STAFF, sees: false },
    { who: KR_ADMIN, sees: true },
  ];
  for (const { who, sees } of people) {
    const context = await browser.newContext();
    await signInAs(who, context);
    const tab = await context.newPage();
    await openTracker(tab, job.id);
    const fee = card(tab, "i1_0p");
    // The title, number and status always show; the panel and its files only for those who may see them.
    await expect(fee.getByRole("heading", { name: "1.0 Fee proposal" })).toBeVisible();
    if (sees) {
      await expect(fee.getByRole("button", { name: "fee-proposal.pdf", exact: true })).toBeVisible();
      await expect(fee.getByText(restricted)).toHaveCount(0);
    } else {
      await expect(fee.getByText(restricted)).toBeVisible();
      await expect(fee.getByText("fee-proposal.pdf")).toHaveCount(0);
    }
    await context.close();
  }

  // The architect can look but not change anything: the page says so and the controls are off.
  await signInAs(architect);
  await openTracker(page, job.id);
  await expect(page.getByText("You have view-only access to this tracker, so changes can't be saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "EDIT JOB" })).toHaveCount(0);
  const quote = card(page, "i6_1a");
  await expect(quote.getByRole("button", { name: "Accept quote" })).toBeDisabled();
  await expect(card(page, "i2_0").getByRole("button", { name: "Completed", exact: true })).toBeDisabled();
});
