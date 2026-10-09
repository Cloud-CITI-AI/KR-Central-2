import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("is a region labelled by its h2 title", async () => {
    const { container } = render(<Panel title="Sign in">Body</Panel>);
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sign in" })).toHaveTextContent("Body");
    await expectNoAxeViolations(container);
  });

  it("renders without a title or label", () => {
    render(<Panel>Just text</Panel>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Just text")).toBeInTheDocument();
  });
});
