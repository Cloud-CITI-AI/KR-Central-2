import { EVIDENCE_ACCEPT } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { BadRequestError, UnsupportedMediaTypeError } from "../../../platform/errors.js";
import { assertAcceptedContent, describeAccept, resolveUploadTarget } from "./upload-target.js";

const COND = "5c1f6a0e-3b1d-4c8e-9a52-1d2f3a4b5c6d";

describe("resolveUploadTarget", () => {
  it("staff slots need files.upload.staff_slots", () => {
    const t = resolveUploadTarget({ checkpointKey: "i2_0", slot: "survey" });
    expect(t).toMatchObject({ type: "slot", checkpointKey: "i2_0", accept: ["pdf", "dwg"] });
    expect(t.required).toEqual(["files.upload.staff_slots"]);
  });

  it("staff_and_client slots need files.upload.client_slots (letter of consent 3.0)", () => {
    expect(resolveUploadTarget({ checkpointKey: "i3_0p", slot: "consent" }).required).toEqual([
      "files.upload.client_slots",
    ]);
  });

  it("the fee proposal slot also needs fee_proposal.view", () => {
    expect(resolveUploadTarget({ checkpointKey: "i1_0p", slot: "documents" }).required).toEqual([
      "files.upload.staff_slots",
      "fee_proposal.view",
    ]);
  });

  it("evidence needs conditions.evidence.upload and accepts the generic kinds", () => {
    expect(resolveUploadTarget({ conditionId: COND })).toEqual({
      type: "evidence",
      conditionId: COND,
      accept: EVIDENCE_ACCEPT,
      required: ["conditions.evidence.upload"],
    });
  });

  it("an unknown slot of a real checkpoint is a 400 on the slot field", () => {
    expect(() => resolveUploadTarget({ checkpointKey: "i2_0", slot: "nope" })).toThrow(BadRequestError);
    try {
      resolveUploadTarget({ checkpointKey: "i2_0", slot: "nope" });
    } catch (e) {
      expect((e as BadRequestError).errors?.[0]?.path).toBe("slot");
    }
  });
});

describe("assertAcceptedContent", () => {
  it("passes a kind the slot accepts", () => {
    expect(() => {
      assertAcceptedContent({ kind: "pdf", contentType: "application/pdf", extension: "pdf" }, ["pdf"]);
    }).not.toThrow();
  });

  it("refuses a rejected file with the classifier's reason", () => {
    try {
      assertAcceptedContent({ rejected: "HTML and XML documents are not accepted" }, ["pdf"]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedMediaTypeError);
      expect((e as UnsupportedMediaTypeError).detail).toBe("HTML and XML documents are not accepted");
    }
  });

  it("refuses a kind outside the accept list and names what is accepted", () => {
    try {
      assertAcceptedContent({ kind: "image", contentType: "image/png", extension: "png" }, ["pdf", "dwg"]);
      expect.unreachable();
    } catch (e) {
      expect((e as UnsupportedMediaTypeError).detail).toBe("This box accepts PDF or DWG files only.");
    }
  });
});

describe("describeAccept", () => {
  it("reads as a short list", () => {
    expect(describeAccept(["pdf"])).toBe("PDF");
    expect(describeAccept(["pdf", "image"])).toBe("PDF or photo");
    expect(describeAccept(EVIDENCE_ACCEPT)).toBe("PDF, photo, video or text");
    expect(describeAccept(["email"])).toBe("Outlook .msg or .eml email");
  });
});
