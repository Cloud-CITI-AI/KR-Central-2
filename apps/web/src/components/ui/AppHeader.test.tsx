import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { AppHeader } from "./AppHeader";

describe("AppHeader", () => {
  it("shows the hero: logo, tag, H1, tagline and, by default, only the theme control (public pages)", async () => {
    const { container } = render(<AppHeader />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "KR Surveys" })).toBeInTheDocument();
    expect(screen.getByText("Subdivision Tracker")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "KR Surveys Subdivision Tracker" })).toBeInTheDocument();
    expect(screen.getByText("Keeping you up to date with your subdivision")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("puts the given controls in the hero bar instead", () => {
    render(<AppHeader controls={<span>Custom controls</span>} />);
    expect(screen.getByText("Custom controls")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });
});
