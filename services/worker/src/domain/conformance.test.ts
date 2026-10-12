import { ISO_DATE_MAX, ISO_DATE_MIN } from "@kr/contracts";
import { READABLE_DATE_MAX, READABLE_DATE_MIN } from "@kr/document-parsing";
import { describe, expect, it } from "vitest";
import {
  findConformedDate,
  foundResult,
  noStampResult,
  unreadableResult,
  type Found,
  type ReadingSteps,
} from "./conformance.js";

const found = (method: Found["method"], date = "2026-03-16", stampText: string | null = null): Found => ({
  date,
  method,
  stampText,
});

/** Steps that answer from `answers` and record which ones were asked, in order. */
function steps(answers: Partial<Record<"fileName" | "stampAnnotation" | "stampImage" | "text", Found>>) {
  const asked: string[] = [];
  const step = (name: keyof typeof answers) => () => {
    asked.push(name);
    return Promise.resolve(answers[name] ?? null);
  };
  const reading: ReadingSteps = {
    fileName: () => {
      asked.push("fileName");
      return answers.fileName ?? null;
    },
    stampAnnotation: step("stampAnnotation"),
    stampImage: step("stampImage"),
    text: step("text"),
  };
  return { reading, asked };
}

describe("findConformedDate (the §10.1 order)", () => {
  it("asks file name, stamp annotation, AI, text in that order when nothing is found", async () => {
    const { reading, asked } = steps({});
    expect(await findConformedDate(reading)).toBeNull();
    expect(asked).toEqual(["fileName", "stampAnnotation", "stampImage", "text"]);
  });

  it("puts the AI step before the text rule even when the text has a conformed date", async () => {
    const { reading, asked } = steps({
      stampImage: found("stamp_image", "2026-03-10"),
      text: found("text", "2026-03-11"),
    });
    expect((await findConformedDate(reading))?.method).toBe("stamp_image");
    expect(asked).toEqual(["fileName", "stampAnnotation", "stampImage"]);
  });

  it.each(["fileName", "stampAnnotation", "text"] as const)(
    "stops at the first step that finds a date (%s)",
    async (name) => {
      const method = { fileName: "file_name", stampAnnotation: "stamp_annotation", text: "text" }[
        name
      ] as Found["method"];
      const { reading, asked } = steps({ [name]: found(method) });
      expect((await findConformedDate(reading))?.method).toBe(method);
      expect(asked.at(-1)).toBe(name);
    },
  );
});

describe("findConformedDate keeps dates in range (QA r2: an out-of-range date is treated as not found)", () => {
  it("shares the API's 1900-2199 range with the document readers (contracts and document-parsing cannot import each other)", () => {
    expect([READABLE_DATE_MIN, READABLE_DATE_MAX]).toEqual([ISO_DATE_MIN, ISO_DATE_MAX]);
  });

  it.each(["1899-12-31", "2200-01-01", "2999-03-03"])(
    "skips a conformed date of %s and tries the next step",
    async (date) => {
      const { reading, asked } = steps({ stampAnnotation: found("stamp_annotation", date), text: found("text") });
      expect((await findConformedDate(reading))?.method).toBe("text");
      expect(asked).toEqual(["fileName", "stampAnnotation", "stampImage", "text"]);
    },
  );

  it("skips a conformed date whose +90 day outcome date would pass 2199-12-31", async () => {
    const { reading } = steps({ stampImage: found("stamp_image", "2199-12-31") });
    expect(await findConformedDate(reading)).toBeNull();
    const edge = steps({ stampImage: found("stamp_image", "2199-10-02") });
    expect((await findConformedDate(edge.reading))?.date).toBe("2199-10-02");
    const over = steps({ stampImage: found("stamp_image", "2199-10-03") });
    expect(await findConformedDate(over.reading)).toBeNull();
  });

  it("skips a date that is not a real calendar date", async () => {
    const { reading } = steps({ fileName: found("file_name", "2026-02-30") });
    expect(await findConformedDate(reading)).toBeNull();
  });
});

describe("the messages (PRODUCT_SPEC §10.1)", () => {
  it("says where the date came from, with the date as 'Mon, 16 Mar 2026'", () => {
    expect(foundResult(found("file_name")).message).toBe("Taken from the file name: Mon, 16 Mar 2026.");
    expect(foundResult(found("stamp_annotation")).message).toBe("Read from the stamp on page 1: Mon, 16 Mar 2026.");
    expect(foundResult(found("stamp_image", "2026-03-16", "DATE 16-Mar-2026 FILE 123-26")).message).toBe(
      'Read from the stamp on page 1 ("DATE 16-Mar-2026 FILE 123-26"): Mon, 16 Mar 2026. Please check it below.',
    );
    expect(foundResult(found("stamp_image")).message).toBe(
      "Read from the stamp on page 1: Mon, 16 Mar 2026. Please check it below.",
    );
    expect(foundResult(found("text")).message).toBe(
      'No stamp could be read, so the "conformed" date in the text was used: Mon, 16 Mar 2026. Please check it below.',
    );
  });

  it("returns the date, method and stamp text with a found result, and nulls otherwise", () => {
    expect(foundResult(found("stamp_image", "2026-03-16", "S"))).toMatchObject({
      found: true,
      date: "2026-03-16",
      method: "stamp_image",
      stampText: "S",
    });
    expect(noStampResult("Notice.pdf")).toEqual({
      found: false,
      date: null,
      method: null,
      stampText: null,
      message: "No stamped date could be found on page 1 of Notice.pdf. Enter the conformed date below.",
    });
    expect(unreadableResult("Notice.pdf").message).toBe("Notice.pdf couldn't be read. Enter the conformed date below.");
  });
});
