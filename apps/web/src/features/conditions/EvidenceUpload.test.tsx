import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticFile, uploadResult } from "@/features/checkpoints/test-fixtures";
import { stubUploads } from "@/features/checkpoints/test-upload";
import { renderCard } from "@/features/checkpoints/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { checklistCard as group, threeConditions } from "./test-utils";
import { conditionAt, withCondition } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const zone = (number: number) => within(group(number)).getByLabelText(/Drop clearance evidence here/);
const pdf = (name: string) => new File([new Uint8Array(4)], name, { type: "application/pdf" });

describe("condition evidence upload", () => {
  it("offers the small zone in every card, with its label, hint and the kinds evidence takes", async () => {
    const { container } = renderCard(threeConditions(), "i5_0");
    for (const number of [1, 2, 3]) {
      expect(within(group(number)).getByText("Drop clearance evidence here")).toBeInTheDocument();
      expect(within(group(number)).getByText("photos, stat dec, approvals – or click to choose")).toBeInTheDocument();
    }
    const accept = zone(1).getAttribute("accept") ?? "";
    for (const extension of [".pdf", ".png", ".jpg", ".webp", ".mp4", ".txt"]) expect(accept).toContain(extension);
    expect(accept).not.toContain(".dwg");
    await expectNoAxeViolations(container);
  });

  it("names each condition's file input after the condition, so the inputs can be told apart", () => {
    renderCard(threeConditions(), "i5_0");
    const names = [1, 2, 3].map((number) => zone(number));
    expect(names.map((input) => input.closest("label")?.textContent)).toEqual([
      "Drop clearance evidence here (condition 1)photos, stat dec, approvals – or click to choose",
      "Drop clearance evidence here (condition 2)photos, stat dec, approvals – or click to choose",
      "Drop clearance evidence here (condition 3)photos, stat dec, approvals – or click to choose",
    ]);
    expect(names[0]).toHaveAccessibleName(/^Drop clearance evidence here ?\(condition 1\) ?photos, stat dec/);
    expect(names[1]).toHaveAccessibleName(/^Drop clearance evidence here ?\(condition 2\) ?photos, stat dec/);
    expect(names[2]).toHaveAccessibleName(/^Drop clearance evidence here ?\(condition 3\) ?photos, stat dec/);
  });

  it("uploads a file for the condition with its id, shows it at once and refreshes the job", async () => {
    const job = threeConditions();
    const target = conditionAt(job, 1);
    const requests = stubUploads();
    const { served } = renderCard(job, "i5_0");
    await userEvent.upload(zone(2), pdf("Stat dec.pdf"));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const [request] = requests;
    expect(request?.body?.get("conditionId")).toBe(target.id);
    expect(request?.body?.get("checkpointKey")).toBeNull();
    expect(request?.body?.get("slot")).toBeNull();
    expect(request?.fields.file).toBe("Stat dec.pdf");
    expect(request?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await within(group(2)).findByLabelText("Uploading Stat dec.pdf")).toBeInTheDocument();
    request?.progress(0.5);
    expect(await within(group(2)).findByText("Stat dec.pdf – 50%")).toBeInTheDocument();
    const stored = syntheticFile(job.id, { name: "Stat dec.pdf", conditionId: target.id, scanStatus: "pending" });
    served.job = withCondition(job, target.id, { evidence: [stored] });
    request?.finish(201, uploadResult(stored));
    expect(await within(group(2)).findByRole("button", { name: "Stat dec.pdf" })).toBeInTheDocument();
    expect(within(group(2)).getByText("Scanning…")).toBeInTheDocument();
    expect(await screen.findByText("1 file uploaded")).toBeInTheDocument();
    expect(within(group(1)).queryByRole("button", { name: "Stat dec.pdf" })).not.toBeInTheDocument();
  });

  it("lists a refused file under the zone with its reason while the others go through", async () => {
    const job = threeConditions();
    const target = conditionAt(job, 0);
    const state: { served?: { job: typeof job } } = {};
    const requests = stubUploads((xhr) => {
      const name = (xhr.body?.get("file") as File).name;
      queueMicrotask(() => {
        if (name === "Run.exe.pdf") {
          xhr.finish(415, {
            type: "urn:kr:problem:unsupported-media-type",
            title: "Unsupported",
            status: 415,
            requestId: "r1",
          });
          return;
        }
        const stored = syntheticFile(job.id, { name, conditionId: target.id });
        if (state.served) state.served.job = withCondition(job, target.id, { evidence: [stored] });
        xhr.finish(201, uploadResult(stored));
      });
    });
    const { served } = renderCard(job, "i5_0");
    state.served = served;
    await userEvent.upload(zone(1), [pdf("Run.exe.pdf"), pdf("Good.pdf")]);
    expect(
      await within(group(1)).findByText(
        "Run.exe.pdf isn't a supported type for this box (use PDF, photo, video or text)",
      ),
    ).toBeInTheDocument();
    expect(await within(group(1)).findByRole("button", { name: "Good.pdf" })).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it("checks the type and size before sending anything", async () => {
    const job = threeConditions();
    const requests = stubUploads();
    renderCard(job, "i5_0");
    await userEvent.upload(zone(1), new File([new Uint8Array(4)], "Plan.dwg", { type: "application/octet-stream" }), {
      applyAccept: false,
    });
    expect(
      await within(group(1)).findByText("Plan.dwg isn't a supported type for this box (use PDF, photo, video or text)"),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("is open to clients and architects, who may attach evidence but not edit", () => {
    renderCard(threeConditions({ role: "external", grantRole: "client" }), "i5_0");
    expect(zone(1)).toBeEnabled();
  });

  it("shows no zone to someone without conditions.evidence.upload", () => {
    const base = threeConditions();
    renderCard({ ...base, capabilities: base.capabilities.filter((c) => c !== "conditions.evidence.upload") }, "i5_0");
    expect(screen.queryByText("Drop clearance evidence here")).not.toBeInTheDocument();
  });
});
