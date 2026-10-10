import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPage } from "./StatusPage";

describe("StatusPage", () => {
  it("is a whole page by default: hero header, main and one panel with the request id", () => {
    render(
      <StatusPage title="Something went wrong" requestId="req-1">
        <p>Try again.</p>
      </StatusPage>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-1")).toBeInTheDocument();
  });

  it("inShell renders only the panel, for a layout that already has the header and main", () => {
    render(
      <StatusPage title="Page not found" inShell>
        <p>Nothing here.</p>
      </StatusPage>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
