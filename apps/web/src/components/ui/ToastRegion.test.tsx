import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "@/lib/toast/ToastProvider";
import { expectNoAxeViolations } from "@/test/axe";
import { ToastRegion } from "./ToastRegion";

function Saver() {
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        toast("Saved");
      }}
    >
      Save
    </button>
  );
}

describe("ToastRegion", () => {
  it("is a polite status region that is present before any toast and announces new ones", async () => {
    const { container } = render(
      <ToastProvider>
        <Saver />
        <ToastRegion />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-live", "polite");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(region).toHaveTextContent("Saved");
    await expectNoAxeViolations(container);
  });
});
