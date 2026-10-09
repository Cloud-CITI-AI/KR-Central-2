import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Field } from "./Field";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("Field with Input, Textarea and Select", () => {
  it("labels each control programmatically so it can be found and typed into by label", async () => {
    const { container } = render(
      <>
        <Field label="Job number">{(c) => <Input {...c} />}</Field>
        <Field label="Comment">{(c) => <Textarea {...c} />}</Field>
        <Field label="Agency">
          {(c) => (
            <Select {...c}>
              <option>Western Power</option>
              <option>Water Corporation</option>
            </Select>
          )}
        </Field>
      </>,
    );
    await userEvent.type(screen.getByLabelText("Job number"), "S-0001");
    await userEvent.type(screen.getByLabelText("Comment"), "Looks right");
    await userEvent.selectOptions(screen.getByLabelText("Agency"), "Water Corporation");
    expect(screen.getByLabelText("Job number")).toHaveValue("S-0001");
    expect(screen.getByLabelText("Comment")).toHaveValue("Looks right");
    expect(screen.getByLabelText("Agency")).toHaveValue("Water Corporation");
    await expectNoAxeViolations(container);
  });

  it("describes the control with its hint and error, announces the error and marks the control invalid", async () => {
    const { container } = render(
      <Field label="Job number" hint="As on the fee proposal" error="S-0001 is already in use.">
        {(c) => <Input {...c} />}
      </Field>,
    );
    const input = screen.getByLabelText("Job number");
    expect(input).toHaveAccessibleDescription("As on the fee proposal S-0001 is already in use.");
    expect(input).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent("S-0001 is already in use.");
    await expectNoAxeViolations(container);
  });

  it("has no description and is valid without hint or error, and passes native props through", () => {
    render(<Field label="Address">{(c) => <Input {...c} placeholder="Street" disabled />}</Field>);
    const input = screen.getByLabelText("Address");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).toBeValid();
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Street");
  });
});
