// ArrayInput had no tests. It backs every `strings` field in the editor and the
// `type: "strings"` branch of ScalarField, so these also pin the Enter
// behaviour that already worked -- the onPaste change sits in the same handler
// area and Enter is what would break silently.
import { render, screen } from "@testing-library/react";
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
});
