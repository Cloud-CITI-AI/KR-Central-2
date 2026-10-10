import type { Page } from "@playwright/test";

export interface ImageDiff {
  /** Share of the compared area (the larger of the two images in each direction) whose pixels differ noticeably. */
  readonly ratio: number;
  readonly reference: { readonly width: number; readonly height: number };
  readonly actual: { readonly width: number; readonly height: number };
  /** Reference | actual | difference (red) side by side, as a PNG. */
  readonly sideBySide: Buffer;
}

/** A channel difference above this (of 255) in any of red, green, blue or alpha counts as a different pixel. */
const CHANNEL_TOLERANCE = 24;

/**
 * Compares two PNGs with the browser's own decoder and canvas, so no image library is needed. Both are laid on a canvas the size of the
 * larger one, top left aligned: area that only one image has counts as different. `scratch` is any page (it is only used for its canvas).
 */
export async function diffImages(scratch: Page, reference: Buffer, actual: Buffer): Promise<ImageDiff> {
  const result = await scratch.evaluate(
    async ({ referenceUrl, actualUrl, tolerance }) => {
      const load = (url: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            resolve(image);
          };
          image.onerror = () => {
            reject(new Error("The image could not be decoded"));
          };
          image.src = url;
        });
      const [a, b] = await Promise.all([load(referenceUrl), load(actualUrl)]);
      const width = Math.max(a.naturalWidth, b.naturalWidth);
      const height = Math.max(a.naturalHeight, b.naturalHeight);
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("No 2d canvas");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height);
      };
      const first = pixels(a);
      const second = pixels(b);
      const difference = new ImageData(width, height);
      let different = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        const changed =
          Math.abs((first.data[i] ?? 0) - (second.data[i] ?? 0)) > tolerance ||
          Math.abs((first.data[i + 1] ?? 0) - (second.data[i + 1] ?? 0)) > tolerance ||
          Math.abs((first.data[i + 2] ?? 0) - (second.data[i + 2] ?? 0)) > tolerance ||
          Math.abs((first.data[i + 3] ?? 0) - (second.data[i + 3] ?? 0)) > tolerance;
        if (changed) {
          different++;
          difference.data.set([220, 30, 30, 255], i);
        } else {
          // Unchanged pixels are shown faded, so the differences stand out.
          const grey = Math.round(((second.data[i] ?? 0) + (second.data[i + 1] ?? 0) + (second.data[i + 2] ?? 0)) / 3);
          difference.data.set(
            [Math.round(grey * 0.3 + 178), Math.round(grey * 0.3 + 178), Math.round(grey * 0.3 + 178), 255],
            i,
          );
        }
      }
      const gap = 12;
      const sheet = document.createElement("canvas");
      sheet.width = width * 3 + gap * 2;
      sheet.height = height;
      const sheetContext = sheet.getContext("2d");
      if (!sheetContext) throw new Error("No 2d canvas");
      sheetContext.fillStyle = "#808080";
      sheetContext.fillRect(0, 0, sheet.width, sheet.height);
      sheetContext.drawImage(a, 0, 0);
      sheetContext.drawImage(b, width + gap, 0);
      const diffCanvas = document.createElement("canvas");
      diffCanvas.width = width;
      diffCanvas.height = height;
      diffCanvas.getContext("2d")?.putImageData(difference, 0, 0);
      sheetContext.drawImage(diffCanvas, (width + gap) * 2, 0);
      return {
        ratio: different / (width * height),
        reference: { width: a.naturalWidth, height: a.naturalHeight },
        actual: { width: b.naturalWidth, height: b.naturalHeight },
        sheet: sheet.toDataURL("image/png"),
      };
    },
    {
      referenceUrl: `data:image/png;base64,${reference.toString("base64")}`,
      actualUrl: `data:image/png;base64,${actual.toString("base64")}`,
      tolerance: CHANNEL_TOLERANCE,
    },
  );
  return {
    ratio: result.ratio,
    reference: result.reference,
    actual: result.actual,
    sideBySide: Buffer.from(result.sheet.slice("data:image/png;base64,".length), "base64"),
  };
}
