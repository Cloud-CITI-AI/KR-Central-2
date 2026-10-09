import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import PublicLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(public) layout", () => {
  it("shows the hero header (no user controls) around the page, with no footer by default", async () => {
    const { container } = render(
      <PublicLayout>
        <p>Page</p>
      </PublicLayout>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "KR Surveys Subdivision Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Page");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("shows the feedback link when configured, even without an API URL", () => {
    vi.stubEnv("FEEDBACK_URL", "https://forms.example.com/kr");
    vi.stubEnv("API_INTERNAL_URL", "");
    render(<PublicLayout>x</PublicLayout>);
    expect(screen.getByRole("link", { name: "Send feedback" })).toBeInTheDocument();
  });
});
