import { findSlot } from "@kr/workflow";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { SlotZone } from "./SlotZone";
import { syntheticFile, uploadResult } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { renderWithJob } from "./test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

const slot = (checkpoint: string, key: string) => {
  const found = findSlot(checkpoint, key);
  if (!found) throw new Error(`${checkpoint}/${key}`);
  return found;
};
const WATER = slot("i7_1", "documents");
const pdf = (name: string, size = 4) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const input = () => screen.getByLabelText(/Drag and drop the Water Corporation Agreement PDF here/);

describe("SlotZone", () => {
  it("shows the slot's own label and hint, picks PDFs only and has no accessibility violations", async () => {
    const job = syntheticJob();
    const { container } = renderWithJob(<SlotZone job={job} checkpointKey="i7_1" slot={WATER} />, job);
    expect(screen.getByText("Drag and drop the Water Corporation Agreement PDF here")).toBeInTheDocument();
    expect(screen.getByText("PDF – or click to choose")).toBeInTheDocument();
    expect(input()).toHaveAttribute("accept", ".pdf");
    await expectNoAxeViolations(container);
  });

  it.each([
    ["an architect", { role: "external", grantRole: "architect" }, WATER],
    ["a client (staff slot)", { role: "external", grantRole: "client" }, WATER],
  ] as const)("renders nothing for %s, who may not upload into the slot", (_who, options, target) => {
    const job = syntheticJob(options);
    const { container } = renderWithJob(<SlotZone job={job} checkpointKey="i7_1" slot={target} />, job);
    expect(container.querySelector("input")).toBeNull();
  });

  it("lets a client upload into a staff-and-client slot", () => {
    const job = syntheticJob({ role: "external", grantRole: "client" });
    renderWithJob(<SlotZone job={job} checkpointKey="i6_7" slot={slot("i6_7", "notice_of_completion")} />, job);
    expect(screen.getByLabelText(/Drag and drop the Notice of Completion here/)).toBeInTheDocument();
  });

  it("shows Uploading… and the progress while a file goes up, then reports the stored files", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const onUploaded = vi.fn();
    renderWithJob(<SlotZone job={job} checkpointKey="i7_1" slot={WATER} onUploaded={onUploaded} />, job);
    await userEvent.upload(input(), pdf("Agreement.pdf"));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    requests[0]?.progress(0.5);
    expect(await screen.findByRole("progressbar", { name: "Uploading Agreement.pdf" })).toHaveAttribute("value", "0.5");
    const stored = uploadResult(
      syntheticFile(job.id, { name: "Agreement.pdf", checkpointKey: "i7_1", slot: "documents" }),
    );
    requests[0]?.finish(201, stored);
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith([stored]);
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Water Corporation Agreement PDF here")).toBeInTheDocument();
  });

  it("lists the files the API refused under the zone and does not call onUploaded for them", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const onUploaded = vi.fn();
    renderWithJob(<SlotZone job={job} checkpointKey="i7_1" slot={WATER} onUploaded={onUploaded} />, job);
    await userEvent.upload(input(), pdf("Disguised.pdf"));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    requests[0]?.finish(415, {
      type: "urn:kr:problem:unsupported-media-type",
      title: "Unsupported",
      status: 415,
      requestId: "r1",
    });
    expect(await screen.findByText("Disguised.pdf isn't a supported type for this box (use PDF)")).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("checks size before sending: a file over the limit is listed and never uploaded", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    renderWithJob(<SlotZone job={job} checkpointKey="i7_1" slot={WATER} />, job);
    await userEvent.upload(input(), pdf("Huge.pdf", 52_428_801));
    expect(await screen.findByText("Huge.pdf is larger than 50 MB")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("takes a label and hint from the panel and a large zone", () => {
    const job = syntheticJob();
    renderWithJob(
      <SlotZone job={job} checkpointKey="i7_1" slot={WATER} label="Reading the conformed date…" hint="Wait" large />,
      job,
    );
    expect(screen.getByText("Reading the conformed date…")).toBeInTheDocument();
    expect(screen.getByText("Wait")).toBeInTheDocument();
  });
});
