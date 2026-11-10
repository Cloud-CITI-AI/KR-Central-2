import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import PublicLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(public) layout", () => {
  it("shows the KR Central brand line and the theme switch around the page, with no sign-out and no feedback link by default", async () => {
    const { container } = render(
      <PublicLayout>
        <p>Page</p>
      </PublicLayout>,
    );
    expect(screen.getByRole("link", { name: "KR Central home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("banner")).toHaveTextContent("KR CENTRAL");
    expect(screen.getByRole("main")).toHaveTextContent("Page");
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Send feedback" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("shows the feedback link when configured, even without an API URL", () => {
    vi.stubEnv("FEEDBACK_URL", "https://forms.example.com/kr");
    vi.stubEnv("API_INTERNAL_URL", "");
    render(<PublicLayout>x</PublicLayout>);
    expect(screen.getByRole("link", { name: "Send feedback" })).toBeInTheDocument();
  });
});
