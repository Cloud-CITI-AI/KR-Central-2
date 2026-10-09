import type { FileMeta } from "@kr/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticFile } from "./test-fixtures";
import { renderCard, withCheckpoint } from "./test-utils";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));

function photos(
  names: readonly string[],
  options: Parameters<typeof syntheticJob>[0] = {},
  scanStatus: FileMeta["scanStatus"] = "clean",
) {
  const base = syntheticJob(options);
  return withCheckpoint(base, "i11_0", {
    files: names.map((name) =>
      syntheticFile(base.id, {
        name,
        kind: "image",
        contentType: "image/jpeg",
        scanStatus,
        checkpointKey: "i11_0",
        slot: "photos",
      }),
    ),
  });
}

describe("photos panel (11.0)", () => {
  it("starts with none yet and the photo zone", async () => {
    const { container } = renderCard(syntheticJob(), "i11_0");
    expect(screen.getByText("Western Power set-out photos")).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
    expect(screen.getByText("Drag and drop the Western Power set-out photos here")).toBeInTheDocument();
    expect(screen.getByText("JPG, PNG or WebP photos – drop several at once, or click to choose")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View all" })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows a thumbnail per photo from the file content URL and opens the viewer on the clicked one", async () => {
    const job = photos(["Peg 1.jpg", "Peg 2.jpg", "Peg 3.jpg"]);
    const { container } = renderCard(job, "i11_0");
    expect(screen.getByText("3 photos")).toBeInTheDocument();
    const grid = screen.getByRole("button", { name: "Peg 2.jpg", description: "" }).closest("div");
    expect(grid && within(grid).getAllByRole("img")).toHaveLength(3);
    const img = screen.getByRole("img", { name: "Peg 2.jpg" });
    const id = job.checkpoints.find((c) => c.key === "i11_0")?.files[1]?.id;
    expect(img).toHaveAttribute("src", `/api/v1/files/${id}/content`);
    await userEvent.click(screen.getByTitle("Peg 3.jpg"));
    expect(viewer.open).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Peg 3.jpg" })]),
      2,
    );
    await userEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(viewer.open).toHaveBeenLastCalledWith(expect.anything(), 0);
    await expectNoAxeViolations(container);
  });

  it("says 1 photo and shows no View all for a single photo", () => {
    renderCard(photos(["Peg 1.jpg"]), "i11_0");
    expect(screen.getByText("1 photo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View all" })).not.toBeInTheDocument();
  });

  it("lists the rows (to remove a photo) for people who can upload", () => {
    renderCard(photos(["Peg 1.jpg"]), "i11_0");
    expect(screen.getByRole("button", { name: "Remove Peg 1.jpg" })).toBeInTheDocument();
  });

  it("shows a viewer only the thumbnails, without rows or a zone", () => {
    renderCard(photos(["Peg 1.jpg"], { role: "external", grantRole: "client" }), "i11_0");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByText(/Drag and drop/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it("gives a photo that is still being scanned no thumbnail, only its row with Scanning…", () => {
    renderCard(photos(["Peg 1.jpg"], {}, "pending"), "i11_0");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Scanning…")).toBeInTheDocument();
    expect(screen.getByText("1 photo")).toBeInTheDocument();
  });

  it("shows Blocked for a photo that failed the virus scan and cannot open it, even for a viewer", () => {
    renderCard(photos(["Bad.jpg"], { role: "external", grantRole: "client" }, "infected"), "i11_0");
    expect(screen.getByText("Blocked – failed the virus scan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bad.jpg" })).not.toBeInTheDocument();
  });
});
