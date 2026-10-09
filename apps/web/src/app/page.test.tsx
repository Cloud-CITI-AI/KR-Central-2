import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DashboardPage from "./page";

describe("DashboardPage placeholder", () => {
  it("renders the product heading", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "KR Surveys Subdivision Tracker" })).toBeInTheDocument();
  });
});
