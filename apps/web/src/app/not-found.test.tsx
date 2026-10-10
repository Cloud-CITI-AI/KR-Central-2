import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));
const session = vi.hoisted(() => ({ getOptionalMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);

import NotFound, { metadata } from "./not-found";

beforeEach(() => {
  session.getOptionalMe.mockResolvedValue(null);
});

describe("root not-found page", () => {
  it("is branded, shows the request id and links back to the dashboard (no session needed)", async () => {
    incoming.headers = new Headers({ "x-request-id": "req-404-abcd" });
    const { container } = render(await NotFound());
    expect(screen.getByRole("heading", { level: 1, name: "KR Surveys Subdivision Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-404-abcd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("omits the request id when there is none", async () => {
    incoming.headers = new Headers();
    render(await NotFound());
    expect(screen.queryByText(/Request ID/)).toBeNull();
  });

  it("is titled for the page, not the app", () => {
    expect(metadata.title).toBe("Page not found");
  });

  it("for a signed-in person is the whole shell: name, theme, Admin, Sign out and the footer, with one h1 and one main", async () => {
    incoming.headers = new Headers({ "x-request-id": "req-404-shell" });
    const me = syntheticMe("admin");
    session.getOptionalMe.mockResolvedValue(me);
    const { container } = render(await NotFound());
    expect(screen.getByRole("banner")).toHaveTextContent(me.user.displayName);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-404-shell")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("falls back to the signed-out page when the session cannot be read", async () => {
    incoming.headers = new Headers();
    session.getOptionalMe.mockRejectedValue(new Error("API down"));
    render(await NotFound());
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
