import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));

import AppNotFound from "./not-found";

describe("(app) not-found page", () => {
  it("is only the panel: the (app) layout already supplies the header, main and footer", async () => {
    incoming.headers = new Headers({ "x-request-id": "req-404-in-shell" });
    const { container } = render(await AppNotFound());
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-404-in-shell")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    // the panel's title is the page's one h1 (the shell supplies no heading of its own)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    await expectNoAxeViolations(container);
  });
});
