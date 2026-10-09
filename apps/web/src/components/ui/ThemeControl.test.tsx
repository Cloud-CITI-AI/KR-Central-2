import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setTheme } from "@/lib/theme";
import { expectNoAxeViolations } from "@/test/axe";
import { ThemeControl } from "./ThemeControl";

afterEach(() => {
  setTheme("system");
  localStorage.clear();
});

describe("ThemeControl", () => {
  it("offers System, Light and Dark as a labelled group with the current one pressed", async () => {
    const { container } = render(<ThemeControl />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
    await expectNoAxeViolations(container);
  });

  it("applies and remembers the choice, by mouse or keyboard", async () => {
    render(<ThemeControl />);
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("kr-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    screen.getByRole("button", { name: "Light" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await userEvent.click(screen.getByRole("button", { name: "System" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem("kr-theme")).toBeNull();
  });
});
