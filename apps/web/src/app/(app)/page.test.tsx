import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DashboardPage from "./page";

describe("DashboardPage placeholder", () => {
  it("renders a Dashboard h2 and leaves <main> and the h1 to the (app) layout", () => {
    const { container } = render(<DashboardPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();
    expect(container.querySelector("main")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
  });
});
