import { expect, type Locator } from "@playwright/test";

/** pdf.js paints the pages after their canvases exist: wait until the first page has ink on it (and did not fail to draw). */
export async function expectFirstPageDrawn(viewer: Locator): Promise<void> {
  await expect(viewer.locator("canvas")).not.toHaveCount(0);
  await expect
    .poll(
      () =>
        viewer
          .locator("canvas")
          .first()
          .evaluate((canvas: HTMLCanvasElement) => {
            const context = canvas.getContext("2d");
            if (!context || canvas.width === 0) return false;
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            return data.some((value, index) => index % 4 === 0 && value < 200 && data[index + 3] === 255);
          }),
      { message: "the first page of the PDF is drawn" },
    )
    .toBe(true);
}
