import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("shows the prototype text with the size limit generated from the server value", async () => {
    const { container } = render(<Footer maxUploadBytes={52_428_800} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "Status and responsibility are set manually on each checkpoint. Files accepted: PDF, images (PNG, JPG, GIF, WebP), video, and text/CSV files, up to 50 MB each.",
    );
    await expectNoAxeViolations(container);
  });

  it("follows a changed server limit", () => {
    render(<Footer maxUploadBytes={13_107_200} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("up to 12.5 MB each.");
  });

  it("shows 'Send feedback' only when FEEDBACK_URL is configured", () => {
    const { rerender } = render(<Footer maxUploadBytes={1_048_576} />);
    expect(screen.queryByRole("link", { name: "Send feedback" })).toBeNull();
    rerender(<Footer maxUploadBytes={1_048_576} feedbackUrl="https://forms.example.com/kr" />);
    const link = screen.getByRole("link", { name: "Send feedback" });
    expect(link).toHaveAttribute("href", "https://forms.example.com/kr");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when it has nothing to say (public pages without a feedback link)", () => {
    const { container } = render(<Footer />);
    expect(container).toBeEmptyDOMElement();
  });
});
