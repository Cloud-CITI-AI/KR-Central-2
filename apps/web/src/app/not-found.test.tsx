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
  session.getOptionalMe.mockClear();
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

  it("is public even when a session exists: the signed-in 404 is the (app) group's, so no client providers load here", async () => {
    incoming.headers = new Headers({ "x-request-id": "req-404-public" });
    session.getOptionalMe.mockResolvedValue(syntheticMe("admin"));
    const { container } = render(await NotFound());
    expect(session.getOptionalMe).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-404-public")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    await expectNoAxeViolations(container);
  });
});
