import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);

import AppLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(app) layout", () => {
  it("wraps the page in the hero header, a banner region, main and the footer with the server limit", async () => {
    const me = syntheticMe("kr_admin");
    session.getMe.mockResolvedValue(me);
    const { container } = render(await AppLayout({ children: <p>Dashboard goes here</p> }));
    expect(screen.getByRole("banner")).toHaveTextContent(me.user.displayName);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/audit");
    expect(screen.getByRole("main")).toHaveTextContent("Dashboard goes here");
    expect(container.querySelector("[aria-live='polite']")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("up to 50 MB each");
    expect(screen.queryByRole("link", { name: "Send feedback" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("adds the feedback link when FEEDBACK_URL is set", async () => {
    vi.stubEnv("FEEDBACK_URL", "https://forms.example.com/kr");
    session.getMe.mockResolvedValue(syntheticMe("staff"));
    render(await AppLayout({ children: <p>x</p> }));
    expect(screen.getByRole("link", { name: "Send feedback" })).toHaveAttribute("href", "https://forms.example.com/kr");
  });

  it("does not render anything when there is no session (getMe redirects or throws)", async () => {
    session.getMe.mockRejectedValue(new Error("REDIRECT /sign-in"));
    await expect(AppLayout({ children: <p>secret</p> })).rejects.toThrow("REDIRECT");
  });
});
