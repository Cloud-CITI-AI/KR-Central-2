import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { AuditChanges } from "./AuditChanges";

describe("AuditChanges", () => {
  it("reads as field: from → to for every changed field", async () => {
    const { container } = render(
      <AuditChanges changes={{ status: { from: "not_completed", to: "completed" }, version: { from: 3, to: 4 } }} />,
    );
    const [status, version] = screen.getAllByRole("listitem");
    expect(status).toHaveTextContent("status: not_completed → changed to completed");
    expect(version).toHaveTextContent("version: 3 → changed to 4");
    await expectNoAxeViolations(container);
  });

  it("shows empty values as 'empty' and objects as JSON", () => {
    render(
      <AuditChanges changes={{ kr_note: { from: null, to: "Called the client" }, tags: { from: "", to: { a: 1 } } }} />,
    );
    const [note, tags] = screen.getAllByRole("listitem");
    expect(note).toHaveTextContent("kr_note: empty → changed to Called the client");
    expect(tags).toHaveTextContent('tags: empty → changed to {"a":1}');
  });

  it("cuts a very long value and keeps the whole text in its title", () => {
    const long = "x".repeat(300);
    render(<AuditChanges changes={{ kr_note: { from: "short", to: long } }} />);
    const shown = screen.getByTitle(long);
    expect(shown.textContent).toBe(`${"x".repeat(160)}…`);
  });

  it("shows a dash when nothing changed", () => {
    render(<AuditChanges changes={null} />);
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
