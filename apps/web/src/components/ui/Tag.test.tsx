import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Tag } from "./Tag";

describe("Tag", () => {
  it.each(["fee", "krpay", "claim", "trig"] as const)("renders its text for variant %s", async (variant) => {
    const { container } = render(<Tag variant={variant}>ITEM 2 PAYMENT REQUIRED</Tag>);
    expect(screen.getByText("ITEM 2 PAYMENT REQUIRED")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("renders without a variant", () => {
    render(<Tag>Plain</Tag>);
    expect(screen.getByText("Plain")).toBeInTheDocument();
  });
});
