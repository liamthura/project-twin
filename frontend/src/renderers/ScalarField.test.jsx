import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScalarField } from "./ScalarField";

describe("ScalarField", () => {
  it("renders a plain input carrying its value", () => {
    render(
      <ScalarField field="title" value="Ship MyGist v3" meta={{}} onChange={() => {}} />
    );
    expect(screen.getByDisplayValue("Ship MyGist v3")).toBeInTheDocument();
  });

  it("renders an ArrayInput for a field in array_fields, showing an existing item as a badge", () => {
    render(
      <ScalarField
        field="tags"
        value={["rust", "async"]}
        meta={{ array_fields: ["tags"] }}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("rust")).toBeInTheDocument();
    expect(screen.getByText("async")).toBeInTheDocument();
    // The add-more affordance from ArrayInput, proving this is ArrayInput
    // and not some other control that happens to render the item text.
    expect(screen.getByPlaceholderText("Add tags…")).toBeInTheDocument();
  });

  it("renders a Textarea for a field in long_text given as a Set", () => {
    render(
      <ScalarField
        field="notes"
        value="some longer notes"
        meta={{ long_text: new Set(["notes"]) }}
        onChange={() => {}}
      />
    );
    const el = screen.getByDisplayValue("some longer notes");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("renders a Textarea for a field in long_text given as a plain array (the manifest/schema shape)", () => {
    // meta_schema.json declares `long_text` as a JSON array, so a node built
    // straight from a manifest (node.long_text) is array-shaped, not a Set.
    // ScalarField must normalise rather than silently degrading to an Input.
    render(
      <ScalarField
        field="notes"
        value="some longer notes"
        meta={{ long_text: ["notes"] }}
        onChange={() => {}}
      />
    );
    const el = screen.getByDisplayValue("some longer notes");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("renders a plain Input when long_text is undefined", () => {
    render(
      <ScalarField field="notes" value="short" meta={{}} onChange={() => {}} />
    );
    const el = screen.getByDisplayValue("short");
    expect(el.tagName).toBe("INPUT");
  });

  describe("enum control", () => {
    it("renders segmented buttons with aria-pressed reflecting the current value when four or fewer options exist", () => {
      render(
        <ScalarField
          field="stance"
          value="like"
          meta={{ valid_values: { stance: ["like", "dislike", "avoid", "other"] } }}
          onChange={() => {}}
        />
      );
      expect(screen.getByRole("button", { name: "like", pressed: true })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "dislike", pressed: false })).toBeInTheDocument();
    });

    it("renders a combobox reflecting the current value when more than four options exist", () => {
      render(
        <ScalarField
          field="kind"
          value="podcast"
          meta={{
            valid_values: { kind: ["book", "article", "podcast", "show", "film"] },
          }}
          onChange={() => {}}
        />
      );
      const combo = screen
        .getAllByRole("combobox")
        .find((el) => el.textContent === "podcast");
      expect(combo).toBeTruthy();
    });
  });

  describe("custom_* input", () => {
    const meta = {
      valid_values: { stance: ["like", "dislike", "avoid", "other"] },
      optional: ["custom_stance"],
    };

    it("appears when the value is 'other' and custom_<field> is in meta.optional", () => {
      render(
        <ScalarField
          field="stance"
          value="other"
          meta={meta}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.getByDisplayValue("niche thing")).toBeInTheDocument();
    });

    it("does not appear when the value is not 'other', even if custom_<field> is optional", () => {
      render(
        <ScalarField
          field="stance"
          value="like"
          meta={meta}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.queryByDisplayValue("niche thing")).not.toBeInTheDocument();
    });

    it("does not appear when the value is 'other' but custom_<field> is not in meta.optional", () => {
      render(
        <ScalarField
          field="stance"
          value="other"
          meta={{ valid_values: meta.valid_values, optional: [] }}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.queryByDisplayValue("niche thing")).not.toBeInTheDocument();
    });
  });
});
