import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Folder, FolderHeader, FolderHint, SlotTitle } from "./Folder";

describe("Folder", () => {
  it("shows the title, the count and the action of a folder, with the icon hidden from screen readers", async () => {
    const { container } = render(
      <Folder>
        <FolderHeader title="Fee proposal documents" count="2 files" action={<button>Open all</button>} />
        <FolderHint>Upload the fee proposal here for the client to review.</FolderHint>
      </Folder>,
    );
    expect(screen.getByText("Fee proposal documents").tagName).toBe("B");
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open all" })).toBeInTheDocument();
    expect(screen.getByText("Upload the fee proposal here for the client to review.")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("renders a header without an action and a sub-folder title", () => {
    render(
      <Folder slot>
        <SlotTitle>Clearance PDF</SlotTitle>
        <FolderHeader title="Clearance" count="not received yet" />
      </Folder>,
    );
    expect(screen.getByText("Clearance PDF")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
