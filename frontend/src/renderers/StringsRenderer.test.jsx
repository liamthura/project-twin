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

  it("renders the node's description when it has one", () => {
    const described = { ...node, description: "What matters to you" };
    render(<StringsRenderer node={described} items={[]} onItems={() => {}} />);
    expect(screen.getByText("What matters to you")).toBeInTheDocument();
  });

  it("renders a usable input when nothing is stored", () => {
    // Waves 3 and 4 both shipped sections with no reachable way to add a first
    // item, so the empty state gets its own assertion in every list renderer.
    render(<StringsRenderer node={node} items={[]} onItems={() => {}} />);
    expect(screen.getByPlaceholderText(node.placeholder)).toBeEnabled();
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
