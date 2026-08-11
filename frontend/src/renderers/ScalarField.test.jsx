import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    // The v2 spelling: fieldMeta's descriptor path sets `meta.allow_custom`
    // from the field's own `allow_custom: true` rather than a `custom_<field>`
    // entry in `optional` -- goals.type is the one shipped field that declares
    // it. ScalarField has to honour both spellings, since the suite above
    // proves the old one is still very much alive.
    it("appears when the value is 'other' and the field is named in meta.allow_custom", () => {
      render(
        <ScalarField
          field="stance"
          value="other"
          meta={{ valid_values: meta.valid_values, allow_custom: ["stance"] }}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.getByDisplayValue("niche thing")).toBeInTheDocument();
    });

    it("does not appear when the field is in meta.allow_custom but the value is not 'other'", () => {
      render(
        <ScalarField
          field="stance"
          value="like"
          meta={{ valid_values: meta.valid_values, allow_custom: ["stance"] }}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.queryByDisplayValue("niche thing")).not.toBeInTheDocument();
    });

    it("does not appear from allow_custom naming a different field", () => {
      render(
        <ScalarField
          field="stance"
          value="other"
          meta={{ valid_values: meta.valid_values, allow_custom: ["other_field"] }}
          onChange={() => {}}
          customValue="niche thing"
          onCustomChange={() => {}}
        />
      );
      expect(screen.queryByDisplayValue("niche thing")).not.toBeInTheDocument();
    });
  });

  describe("a field in date_fields", () => {
    const meta = { date_fields: ["target_date"] };

    it("renders a native date picker when the value is a yyyy-mm-dd date", () => {
      render(
        <ScalarField field="target_date" value="2026-12-31" meta={meta} onChange={() => {}} />
      );
      const input = screen.getByDisplayValue("2026-12-31");
      expect(input).toHaveAttribute("type", "date");
    });

    it("renders an empty date picker when there is no value", () => {
      const { container } = render(
        <ScalarField field="target_date" value={undefined} meta={meta} onChange={() => {}} />
      );
      const input = container.querySelector("input");
      expect(input).toHaveAttribute("type", "date");
      expect(input.value).toBe("");
    });

    // The data-safety case. Nothing validates this field on write -- an MCP
    // client can store "next spring" -- and <input type="date"> discards any
    // value it cannot parse. Rendering a picker there would show empty and
    // write that emptiness back, losing what the user had.
    it("keeps a non-ISO value in a text input rather than a picker", () => {
      render(
        <ScalarField field="target_date" value="next spring" meta={meta} onChange={() => {}} />
      );
      const input = screen.getByDisplayValue("next spring");
      expect(input).not.toHaveAttribute("type", "date");
    });

    it("reports the picked date as a plain yyyy-mm-dd string", () => {
      const onChange = vi.fn();
      render(
        <ScalarField field="target_date" value="2026-12-31" meta={meta} onChange={onChange} />
      );
      fireEvent.change(screen.getByDisplayValue("2026-12-31"), {
        target: { value: "2027-01-15" },
      });
      expect(onChange).toHaveBeenCalledWith("2027-01-15");
    });

    it("leaves a field alone when it is not listed in date_fields", () => {
      render(
        <ScalarField field="target_date" value="2026-12-31" meta={{}} onChange={() => {}} />
      );
      expect(screen.getByDisplayValue("2026-12-31")).not.toHaveAttribute("type", "date");
    });

    it("lets an enum win over date_fields for the same field", () => {
      render(
        <ScalarField
          field="target_date"
          value="soon"
          meta={{ date_fields: ["target_date"], valid_values: { target_date: ["soon", "later"] } }}
          onChange={() => {}}
        />
      );
      expect(screen.queryByDisplayValue("soon")).not.toBeInTheDocument();
    });
  });

  describe("field_placeholders", () => {
    // Declared per field in the manifest, keyed like field_defaults. Restores
    // the hint copy the hand-written editors carried -- "e.g. Bachelor's,
    // Master's, PhD" says more about degree_level than its label can.
    const withHint = (extra = {}) => ({
      field_placeholders: { thing: "e.g. a hint" },
      long_text: new Set(),
      array_fields: [],
      date_fields: [],
      time_fields: [],
      optional: [],
      ...extra,
    });

    it("puts the hint on a plain text input", () => {
      render(<ScalarField field="thing" value="" meta={withHint()} onChange={() => {}} />);
      expect(screen.getByPlaceholderText("e.g. a hint")).toBeInTheDocument();
    });

    it("puts the hint on a textarea", () => {
      const meta = withHint({ long_text: new Set(["thing"]) });
      render(<ScalarField field="thing" value="" meta={meta} onChange={() => {}} />);
      expect(screen.getByPlaceholderText("e.g. a hint").tagName).toBe("TEXTAREA");
    });

    it("puts the hint on a chip list, overriding the derived one", () => {
      const meta = withHint({ array_fields: ["thing"] });
      render(<ScalarField field="thing" value={[]} meta={meta} onChange={() => {}} />);
      expect(screen.getByPlaceholderText("e.g. a hint")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("Add thing…")).not.toBeInTheDocument();
    });

    it("falls back to the derived chip hint when no entry exists", () => {
      const meta = withHint({ array_fields: ["other"] });
      render(<ScalarField field="other" value={[]} meta={meta} onChange={() => {}} />);
      expect(screen.getByPlaceholderText("Add other…")).toBeInTheDocument();
    });

    it("leaves a field with no entry unhinted, as every field was before", () => {
      render(<ScalarField field="other" value="" meta={withHint()} onChange={() => {}} />);
      expect(screen.getByRole("textbox")).not.toHaveAttribute("placeholder");
    });

    it("survives a node that declares none at all", () => {
      const meta = { long_text: new Set(), array_fields: [], date_fields: [], optional: [] };
      expect(() =>
        render(<ScalarField field="thing" value="" meta={meta} onChange={() => {}} />)
      ).not.toThrow();
    });
  });


  describe("bool_fields", () => {
    const boolMeta = {
      bool_fields: ["prefer_code_blocks"],
      long_text: new Set(), array_fields: [], date_fields: [], time_fields: [], optional: [],
    };

    it("renders a switch, not a text input", () => {
      render(<ScalarField field="prefer_code_blocks" value={true} meta={boolMeta} onChange={() => {}} />);
      expect(screen.getByRole("switch")).toBeChecked();
    });

    it("reads a missing key as off rather than inventing a third state", () => {
      render(<ScalarField field="prefer_code_blocks" value={undefined} meta={boolMeta} onChange={() => {}} />);
      expect(screen.getByRole("switch")).not.toBeChecked();
    });

    it("writes a real boolean, never a string", () => {
      const onChange = vi.fn();
      render(<ScalarField field="prefer_code_blocks" value={false} meta={boolMeta} onChange={onChange} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(true);
      expect(typeof onChange.mock.calls[0][0]).toBe("boolean");
    });

    it("leaves a field outside bool_fields as a text input", () => {
      render(<ScalarField field="other" value="" meta={boolMeta} onChange={() => {}} />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

});
