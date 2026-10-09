import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisuallyHidden } from "./VisuallyHidden";

describe("VisuallyHidden", () => {
  it("keeps its text in the accessibility tree", () => {
    render(
      <button>
        <VisuallyHidden>Remove</VisuallyHidden>×
      </button>,
    );
    expect(screen.getByRole("button", { name: "Remove×" })).toBeInTheDocument();
  });
});
