import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("is a status with a label for screen readers", async () => {
    const { container } = render(<Spinner label="Reading the conformed date…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading the conformed date…");
    await expectNoAxeViolations(container);
  });

  it("defaults the label to Loading…", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});
