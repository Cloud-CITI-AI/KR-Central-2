import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));

import NotFound, { metadata } from "./not-found";

describe("not-found page", () => {
  it("is branded, shows the request id and links back to the dashboard", async () => {
    incoming.headers = new Headers({ "x-request-id": "req-404-abcd" });
    const { container } = render(await NotFound());
    expect(screen.getByRole("heading", { level: 1, name: "KR Surveys Subdivision Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-404-abcd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
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
});
