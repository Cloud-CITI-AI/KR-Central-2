import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wrap } from "./Wrap";

describe("Wrap", () => {
  it("renders its children in the requested element", () => {
    render(
      <Wrap as="main">
        <p>Content</p>
      </Wrap>,
    );
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Content"));
  });

  it("adds the spacing class only when asked", () => {
    const { rerender } = render(<Wrap as="main">x</Wrap>);
    const plain = screen.getByRole("main").className;
    rerender(
      <Wrap as="main" spaced>
        x
      </Wrap>,
    );
    expect(screen.getByRole("main").className).not.toBe(plain);
  });
});
