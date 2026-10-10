import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { dwgFile, pdfFile, pngFile, textFile } from "../support/documents";
import { card, fileInput, openTracker } from "../support/tracker";
import { expectFirstPageDrawn } from "../support/viewer";

// PRODUCT_SPEC §5.5 (drop zones, file rows), §11 (files) and §11.1 (document viewer), through the real API, worker and pdf.js.

test("staff upload the survey PDF and DWG, open the PDF in the viewer, and remove a file", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const survey = card(page, "i2_0");
  await expect(survey.getByText("PDF required")).toBeVisible();
  await expect(survey.getByText("DWG required")).toBeVisible();

  await fileInput(survey).setInputFiles([
    await pdfFile("feature-survey.pdf", [["Synthetic feature survey, page 1"], ["Page 2"]]),
    dwgFile("feature-survey.dwg"),
  ]);
  await expect(survey.getByText("✓ PDF received")).toBeVisible();
  await expect(survey.getByText("✓ DWG received")).toBeVisible();
  await expect(survey.getByText("2 files")).toBeVisible();
  // The scan is switched off on this stack: the files settle (no "Scanning…") and can be opened.
  await expect(survey.getByText("Scanning…")).toHaveCount(0);

  await survey.getByRole("button", { name: "feature-survey.pdf", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "feature-survey.pdf" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("canvas")).toHaveCount(2);
  await expectFirstPageDrawn(viewer);
  await expect(viewer.getByText("1 of 2", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Next file" }).click();
  await expect(page.getByRole("dialog", { name: "feature-survey.dwg" })).toContainText(
    "DWG drawings can't be previewed in the browser",
  );
  await expect(page.getByRole("link", { name: "Download feature-survey.dwg" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await survey.getByRole("button", { name: "Remove feature-survey.dwg" }).click();
  await survey.getByRole("button", { name: "Yes" }).click();
  await expect(survey.getByText("1 file", { exact: true })).toBeVisible();
  await expect(survey.getByText("DWG required")).toBeVisible();
});

test("photos show as thumbnails that open the image viewer, and View all pages through them", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const photos = card(page, "i11_0");
  await fileInput(photos).setInputFiles([pngFile("setout-1.png"), pngFile("setout-2.png", 80, 60)]);
  await expect(photos.getByText("2 photos")).toBeVisible();
  await photos.getByRole("button", { name: "setout-2.png" }).first().click();
  const viewer = page.getByRole("dialog", { name: "setout-2.png" });
  await expect(viewer.getByRole("img", { name: "setout-2.png" })).toBeVisible();
  await expect(viewer.getByText("2 of 2", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Previous file" }).click();
  await expect(page.getByRole("dialog", { name: "setout-1.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await photos.getByRole("button", { name: "View all" }).click();
  await expect(page.getByRole("dialog", { name: "setout-1.png" }).getByText("1 of 2", { exact: true })).toBeVisible();
});

test("the server refuses a file that is not what its name says, and the box says so", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await openTracker(page, job.id);
  const survey = card(page, "i2_0");
  await fileInput(survey).setInputFiles(textFile("renamed-script.pdf", "this is plain text, not a PDF"));
  await expect(survey.getByText(/renamed-script\.pdf isn't a supported type for this box \(use [^)]+\)/)).toBeVisible();
  await expect(survey.getByText("empty")).toBeVisible();
});
