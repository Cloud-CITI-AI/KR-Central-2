import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("shows its text", async () => {
    const { container } = render(<EmptyState>No one has been added yet.</EmptyState>);
    expect(screen.getByText("No one has been added yet.")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
