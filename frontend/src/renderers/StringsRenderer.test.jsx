import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StringsRenderer } from "./StringsRenderer";

const node = {
  kind: "strings",
  path: ["values"],
  title: "Values",
  placeholder: "e.g. Integrity, Growth...",
};

describe("StringsRenderer", () => {
  it("renders every stored string", () => {
    render(<StringsRenderer node={node} items={["honesty", "curiosity"]} onItems={() => {}} />);
    expect(screen.getByText("honesty")).toBeInTheDocument();
    expect(screen.getByText("curiosity")).toBeInTheDocument();
  });

  it("appends without mutating the array it was handed", async () => {
    // The section's stored data is passed straight in. Mutating it would edit
    // state in place, and React would not re-render on the next change.
    const items = ["honesty"];
    const onItems = vi.fn();
    render(<StringsRenderer node={node} items={items} onItems={onItems} />);

    await userEvent.type(screen.getByPlaceholderText(node.placeholder), "curiosity{Enter}");

    expect(onItems).toHaveBeenCalledWith(["honesty", "curiosity"]);
    expect(items).toEqual(["honesty"]);
  });

  it("removes the string the user pointed at, not the one beside it", async () => {
    const onItems = vi.fn();
    render(<StringsRenderer node={node} items={["a", "b", "c"]} onItems={onItems} />);

    // Each badge is the string plus its own remove button; take the second.
    const removeButtons = screen.getAllByRole("button").filter((b) => !b.textContent.trim());
    await userEvent.click(removeButtons[1]);

    expect(onItems).toHaveBeenCalledWith(["a", "c"]);
  });

  it("uses the node's placeholder verbatim", () => {
    // The retired editors' concrete examples are the whole reason `placeholder`
    // is a manifest key -- a derived label would silently replace them.
    render(<StringsRenderer node={node} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText("e.g. Integrity, Growth...")).toBeInTheDocument();
  });

  it("derives a singular placeholder when the node declares none", () => {
    const bare = { kind: "strings", path: ["values"], title: "Values" };
    render(<StringsRenderer node={bare} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText("Add value...")).toBeInTheDocument();
  });

  it("derives a placeholder for a multi-word title", () => {
    const bare = { kind: "strings", path: ["t"], title: "Personality Traits" };
    render(<StringsRenderer node={bare} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText("Add personality trait...")).toBeInTheDocument();
  });

  it("leaves `description` to SectionRenderer, which draws it under the heading", () => {
    // It used to render here too, which showed the copy twice -- and having
    // only this renderer honour it silently dropped it on `fields` and `list`
    // nodes that declared one. SectionRenderer.test.jsx owns the assertion
    // that it renders at all.
    const described = { ...node, description: "What matters to you" };
    render(<StringsRenderer node={described} items={[]} onItems={() => {}} />);
    expect(screen.queryByText("What matters to you")).not.toBeInTheDocument();
  });

  it("renders a usable input when nothing is stored", () => {
    // Waves 3 and 4 both shipped sections with no reachable way to add a first
    // item, so the empty state gets its own assertion in every list renderer.
    render(<StringsRenderer node={node} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText(node.placeholder)).toBeEnabled();
  });


  // `control`, not v1's node-level `item_control`: one key, spelled the same on
  // a strings node and on the array field a block is built from.
  describe('control: "input"', () => {
    // Sentence-like values. The retired ProfileEditor gave each highlight its
    // own editable row; chips would mean deleting and retyping a whole
    // achievement to fix one word.
    const rows = { ...node, title: "Highlights", control: "input" };

    it("renders one editable input per stored string", () => {
      render(<StringsRenderer node={rows} items={["Led the migration", "Halved latency"]} onItems={() => {}} />);
      expect(screen.getByDisplayValue("Led the migration")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Halved latency")).toBeInTheDocument();
    });

    it("edits one string in place without disturbing its siblings", async () => {
      const onItems = vi.fn();
      render(<StringsRenderer node={rows} items={["one", "two"]} onItems={onItems} />);

      await userEvent.type(screen.getByDisplayValue("two"), "!");

      expect(onItems).toHaveBeenCalledWith(["one", "two!"]);
    });

    it("does not mutate the array it was handed", async () => {
      const items = ["one"];
      render(<StringsRenderer node={rows} items={items} onItems={vi.fn()} />);
      await userEvent.type(screen.getByDisplayValue("one"), "!");
      expect(items).toEqual(["one"]);
    });

    it("removes the row the user pointed at", async () => {
      const onItems = vi.fn();
      render(<StringsRenderer node={rows} items={["a", "b", "c"]} onItems={onItems} />);

      await userEvent.click(screen.getByRole("button", { name: "Remove highlight 2" }));

      expect(onItems).toHaveBeenCalledWith(["a", "c"]);
    });

    it("appends an empty row to type into", async () => {
      const onItems = vi.fn();
      render(<StringsRenderer node={rows} items={["a"]} onItems={onItems} />);

      await userEvent.click(screen.getByRole("button", { name: /Add highlight/i }));

      expect(onItems).toHaveBeenCalledWith(["a", ""]);
    });

    it("keeps focus while typing -- rows are keyed by index, not by value", async () => {
      // Keying on the value would remount the input on every keystroke, since
      // the value IS what is being typed.
      function Harness() {
        const [items, setItems] = useState(["a"]);
        return <StringsRenderer node={rows} items={items} onItems={setItems} />;
      }
      render(<Harness />);

      await userEvent.type(screen.getByDisplayValue("a"), "bc");

      expect(screen.getByDisplayValue("abc")).toBeInTheDocument();
    });

    it("renders a non-string entry as text rather than throwing", () => {
      // The chip control throws "Objects are not valid as a React child" on a
      // stray object; a row must degrade instead.
      expect(() =>
        render(<StringsRenderer node={rows} items={[{ name: "oops" }]} onItems={() => {}} />)
      ).not.toThrow();
    });
  });

  it("treats a missing stored value as empty rather than throwing", () => {
    expect(() =>
      render(<StringsRenderer node={node} items={undefined} onItems={() => {}} />)
    ).not.toThrow();
  });

  it("treats a non-array stored value as empty rather than throwing", () => {
    // An MCP client can leave any shape behind; ArrayInput would crash on
    // .map of a string.
    expect(() =>
      render(<StringsRenderer node={node} items={"not a list"} onItems={() => {}} />)
    ).not.toThrow();
  });
});
