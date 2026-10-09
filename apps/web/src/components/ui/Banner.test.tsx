import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("shows its text without a dismiss button by default", async () => {
    const { container } = render(<Banner>Someone else changed this — the latest version has been loaded.</Banner>);
    expect(screen.getByText("Someone else changed this — the latest version has been loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("dismisses on request", async () => {
    const onDismiss = vi.fn();
    render(<Banner onDismiss={onDismiss}>Hi</Banner>);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
