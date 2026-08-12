// ArrayInput had no tests. It backs every `strings` field in the editor and the
// `type: "strings"` branch of ScalarField, so these also pin the Enter
// behaviour that already worked -- the onPaste change sits in the same handler
// area and Enter is what would break silently.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ArrayInput } from "./ArrayInput";

function setup(items = []) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ArrayInput items={items} onChange={onChange} placeholder="Add one…" />);
  return { onChange, user, input: screen.getByPlaceholderText("Add one…") };
}

describe("ArrayInput paste", () => {
  it("splits a comma-delimited paste into one chip per value", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue, Svelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("splits on newlines too", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React\nVue\nSvelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("handles both delimiters in one paste", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue\nSvelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("appends to the existing items rather than replacing them", async () => {
    const { onChange, user, input } = setup(["Angular"]);
    await user.click(input);
    await user.paste("React, Vue");
    expect(onChange).toHaveBeenCalledWith(["Angular", "React", "Vue"]);
  });

  it("drops empty and whitespace-only pieces", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, , ,\n  \nVue,");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
  });

  it("commits every piece and clears the input, delimiter at the end or not", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue, Sve");
    // No special case for the final piece: a delimited paste is a list, and
    // withholding its last value only put an extra Enter in the way.
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Sve"]);
    expect(input).toHaveValue("");
  });

  it("leaves the input empty when the paste ends in a delimiter", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue,");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
    expect(input).toHaveValue("");
  });

  it("commits nothing for a paste with no delimiter, and fills the input", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React");
    // Pasting a fragment must stay editable. Committing it would make the
    // input unusable for anyone assembling a value from two sources.
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("React");
  });

  it("accepts a duplicate, exactly as Enter does", async () => {
    const { onChange, user, input } = setup(["React"]);
    await user.click(input);
    await user.paste("React, Vue");
    // No dedupe on either entry route. Adding it to one and not the other is
    // how the two would come to disagree.
    expect(onChange).toHaveBeenCalledWith(["React", "React", "Vue"]);
  });

  it("keeps text already typed, as its own value ahead of the pasted ones", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "Angular");
    await user.paste("React, Vue");
    // The input is cleared on a delimited paste, so "Angular" has to go
    // somewhere or it is silently lost.
    expect(onChange).toHaveBeenCalledWith(["Angular", "React", "Vue"]);
    expect(input).toHaveValue("");
  });
});

describe("ArrayInput chips", () => {
  // Icon-only buttons with no accessible name, one per chip. Pre-existing, but
  // the delimited-paste feature makes twenty of them from a single paste, so the
  // count of unnamed controls is now a function of something this slice added.
  it("names each chip's remove button after its chip", () => {
    setup(["React", "Vue"]);
    expect(screen.getByRole("button", { name: "Remove React" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Vue" })).toBeInTheDocument();
  });

  it("removes the chip its button names", async () => {
    const { onChange, user } = setup(["React", "Vue"]);
    await user.click(screen.getByRole("button", { name: "Remove React" }));
    expect(onChange).toHaveBeenCalledWith(["Vue"]);
  });

  // A Badge can sit inside a form; type="submit" is the default for a bare
  // <button>, and removing a chip must not submit anything.
  it("does not default its remove buttons to submit", () => {
    setup(["React"]);
    expect(screen.getByRole("button", { name: "Remove React" })).toHaveAttribute(
      "type",
      "button"
    );
  });
});

describe("ArrayInput typing", () => {
  it("still commits on Enter after the onKeyDown swap", async () => {
    const { onChange, user, input } = setup(["React"]);
    await user.type(input, "Vue{Enter}");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
    expect(input).toHaveValue("");
  });

  it("ignores Enter on an empty input", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("trims a typed value", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "  React  {Enter}");
    expect(onChange).toHaveBeenCalledWith(["React"]);
  });

  // The regression the onKeyPress -> onKeyDown swap introduced. `keypress` never
  // fired for the Enter that accepts an IME candidate; `keydown` does, flagged
  // `isComposing: true`. So this is not a hypothetical keyboard: it is what every
  // Japanese, Chinese or Korean user does to type a single word.
  //
  // fireEvent, not user.type: user-event models a physical keyboard and has no
  // way to say "this keydown arrived mid-composition", which is exactly the
  // condition under test.
  it("does not commit on the Enter that accepts an IME candidate", () => {
    const onChange = vi.fn();
    render(<ArrayInput items={["React"]} onChange={onChange} placeholder="Add one…" />);
    const input = screen.getByPlaceholderText("Add one…");

    fireEvent.change(input, { target: { value: "にほんご" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    // Nothing committed, and the half-composed text is still there to finish.
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("にほんご");
  });

  it("commits on the next Enter, once composition has ended", () => {
    const onChange = vi.fn();
    render(<ArrayInput items={["React"]} onChange={onChange} placeholder="Add one…" />);
    const input = screen.getByPlaceholderText("Add one…");

    fireEvent.change(input, { target: { value: "にほんご" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    // The second Enter is a plain one -- the candidate is already accepted, so
    // the browser reports no composition. This is the half that proves the guard
    // defers the commit rather than swallowing it.
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });

    expect(onChange).toHaveBeenCalledWith(["React", "にほんご"]);
  });
});
