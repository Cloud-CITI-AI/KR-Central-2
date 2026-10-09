import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Button } from "./Button";

describe("Button", () => {
  it("is a type=button by default so it never submits a form by accident", () => {
    render(<Button>Save as PDF</Button>);
    expect(screen.getByRole("button", { name: "Save as PDF" })).toHaveAttribute("type", "button");
  });

  it("calls onClick for mouse and keyboard (Enter, Space)", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does nothing when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("submits a form only when asked to (type=submit) and keeps aria-pressed", async () => {
    const onSubmit = vi.fn((e: React.SyntheticEvent) => {
      e.preventDefault();
    });
    const { container } = render(
      <form onSubmit={onSubmit}>
        <Button variant="primary" type="submit">
          Sign in
        </Button>
        <Button variant="photo" small aria-pressed="true">
          Dark
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expectNoAxeViolations(container);
  });
});
