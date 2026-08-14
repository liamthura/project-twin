// The Field kit's whole job is the wiring a screen reader depends on and a
// sighted reader never sees. Each test below is one thing that was previously
// hand-written per field, and therefore one thing that was previously possible
// to get wrong in one place and not another.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Input } from "./input";

const renderField = (props) =>
  render(
    <Field id="thing" label="Thing" {...props}>
      {(control) => <Input {...control} />}
    </Field>,
  );

describe("Field", () => {
  it("labels the control, so getByLabelText finds it", () => {
    renderField();
    expect(screen.getByLabelText("Thing")).toBeInTheDocument();
  });

  it("says nothing about validity when there is no error", () => {
    renderField();
    const input = screen.getByLabelText("Thing");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("points the control at its description", () => {
    renderField({ description: "Some help." });
    expect(screen.getByLabelText("Thing")).toHaveAccessibleDescription("Some help.");
  });

  it("marks the control invalid and points it at the message", () => {
    renderField({ error: "That is wrong." });
    const input = screen.getByLabelText("Thing");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That is wrong.");
  });

  it("announces the error, so it is heard without moving focus", () => {
    renderField({ error: "That is wrong." });
    expect(screen.getByRole("alert")).toHaveTextContent("That is wrong.");
  });

  it("describes by the error rather than the help when both are present", () => {
    // Both would be defensible. The error is chosen because it is the newer
    // information and the one that has to be acted on; the help line is still
    // on screen for anyone reading.
    renderField({ description: "Some help.", error: "That is wrong." });
    expect(screen.getByLabelText("Thing")).toHaveAccessibleDescription("That is wrong.");
  });

  it("renders no alert when the error is empty rather than absent", () => {
    // A validator returning "" is a bug in the validator, not a message.
    renderField({ error: "" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Thing")).not.toHaveAttribute("aria-invalid");
  });
});
