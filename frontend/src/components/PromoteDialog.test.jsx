import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PromoteDialog, { missingRequired, promotedData, promotionTargets, startingValues } from "./PromoteDialog";
import packs from "@/__fixtures__/packs.json";

const name = (key, extra = {}) => ({
  key, label: key.charAt(0).toUpperCase() + key.slice(1), type: "text", required: true,
  identifier: true, placeholder: null, values: null, ...extra,
});
const PROMOTABLE = [
  {
    key: "lifestyle", title: "Lifestyle",
    targets: [
      { entity: "hobby", title: "Hobbies", fields: [
        name("name"),
        { key: "skill_level", label: "Skill level", type: "enum", required: false, identifier: false,
          placeholder: null, values: ["beginner", "expert"] },
        { key: "notes", label: "Notes", type: "longtext", required: false, identifier: false, placeholder: null, values: null },
      ] },
      { entity: "value", title: "Values", fields: [name("value", { placeholder: "e.g. honesty" })],
        about: { what: "What matters most when you decide" } },
    ],
  },
  {
    key: "knowledge", title: "Knowledge",
    targets: [{ entity: "mental_tab", title: "Mental tabs", fields: [name("title")] }],
  },
];

function Harness({ onConfirm = vi.fn(), onCancel = vi.fn(), entity = "hobby" }) {
  const [promoting, setPromoting] = useState({
    row: { id: "p2", note: "Wants the recommendation first." },
    section: "lifestyle",
    entity,
    values: entity === "hobby" ? { name: "Wants the recommendation first." } : {},
    fills: {},
  });
  return (
    <PromoteDialog
      promoting={promoting}
      promotable={PROMOTABLE}
      onChange={setPromoting}
      onCancel={onCancel}
      onConfirm={() => onConfirm(promoting)}
    />
  );
}

describe("a Select inside the real Dialog", () => {
  /*
   * Radix keeps module-scope state in react-focus-scope (a stack of focus
   * scopes) and react-dismissable-layer (the body's original pointer-events).
   * When a Dialog and a layer component rendered inside it resolve to
   * different copies of those packages, the inner one's teardown restores
   * `pointer-events: none` onto the body and the dialog goes dead while
   * looking perfectly fine.
   *
   * That is exactly what shipped in slice 2b: an overflow menu that could not
   * open a confirmation dialog passed five task reviews, because no test in
   * the repo rendered two Radix layer components together. `npm ls` says
   * react-select dedupes against react-dialog today. This is what keeps that
   * true when a dependency moves.
   *
   * The explicit timeout is not decoration. This class of failure HANGS
   * rather than going red, so without it a regression reports as silence.
   */
  it("picks an option and leaves the dialog usable", { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const dialog = await screen.findByRole("dialog");
    // A modal dialog legitimately sets `pointer-events: none` on the body
    // while it is open, so the value itself proves nothing. What matters is
    // that opening and closing a Select INSIDE it leaves that value where the
    // dialog put it. Restoring the wrong saved value is the whole failure.
    const bodyPointerEvents = document.body.style.pointerEvents;

    await user.click(within(dialog).getByLabelText(/^type$/i));
    await user.click(await screen.findByRole("option", { name: "Values" }));

    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Values");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.pointerEvents).toBe(bodyPointerEvents);

    await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entity: "value" }));
  });

  it("changing to a section with one type chooses it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/section/i));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));

    // Leaving `hobby` selected under Knowledge would offer a type that
    // section cannot hold, and confirm would file nothing.
    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Mental tabs");
    expect(within(dialog).getByLabelText(/^title$/i)).toBeInTheDocument();
  });

  it("names a section with several types unchosen, and will not promote until one is picked", async () => {
    const user = userEvent.setup();
    render(<Harness entity="" />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Choose a type");
    expect(within(dialog).getByRole("button", { name: /^promote$/i })).toBeDisabled();

    await user.click(within(dialog).getByLabelText(/^type$/i));
    await user.click(await screen.findByRole("option", { name: "Values" }));
    // The field under it takes the editor's label and hint for that type.
    // The field under it takes the type's label and hint, and the note.
    expect(within(dialog).getByLabelText(/^value/i)).toHaveAttribute("placeholder", "e.g. honesty");
    expect(within(dialog).getByLabelText(/^value/i)).toHaveValue("Wants the recommendation first.");
    expect(within(dialog).getByRole("button", { name: /^promote$/i })).toBeEnabled();
  });
});

describe("promotionTargets", () => {
  it("is the server's list for the pack, which the real packs carry", () => {
    // The rule is pack_loader.derive_promotion_targets; the fixture is
    // generated from it, so the dialog offers what the server would.
    const lifestyle = packs.find((p) => p.key === "lifestyle");
    const hobby = promotionTargets(lifestyle).find((t) => t.entity === "hobby");
    expect(hobby.title).toBe("Hobbies & activities");
    expect(hobby.fields.map((f) => f.key)).toEqual(["name", "notes", "skill_level", "status"]);
    expect(hobby.about.what).toMatch(/outside work/);
    expect(promotionTargets({})).toEqual([]);
  });
});

describe("suggestions", () => {
  function Suggested({ suggestions, onChange = vi.fn(), section = "knowledge", entity = "mental_tab" }) {
    const [promoting, setPromoting] = useState({
      row: { id: "p2", note: "Wants the recommendation first." }, section, entity,
      text: "Wants the recommendation first.", suggestions,
    });
    return (
      <PromoteDialog
        promoting={promoting}
        promotable={PROMOTABLE}
        onChange={(fn) => { onChange(fn); setPromoting(fn); }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
  }

  it("offers them across sections, and one tap files it there", async () => {
    const user = userEvent.setup();
    render(<Suggested suggestions={[
      { section: "lifestyle", entity: "value", probability: 0.6 },
      { section: "knowledge", entity: "mental_tab", probability: 0.3 },
    ]} />);
    const group = await screen.findByRole("group", { name: "Suggested" });
    expect(within(group).getByRole("button", { name: /Mental tabs/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "Values, in Lifestyle" }));
    expect(within(group).getByRole("button", { name: /Values/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/^section$/i)).toHaveTextContent("Lifestyle");
    expect(screen.getByLabelText(/^type$/i)).toHaveTextContent("Values");
  });

  it("leaves out a suggestion this dialog could not file", async () => {
    render(<Suggested suggestions={[{ section: "media", entity: "media_item", probability: 0.9 }]} />);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("group", { name: "Suggested" })).not.toBeInTheDocument();
  });

  it("says what the chosen type is for, in the manifest's words", async () => {
    render(<Suggested suggestions={[]} section="lifestyle" entity="value" />);
    expect(await screen.findByText("What matters most when you decide.")).toBeInTheDocument();
  });
});

describe("a type's fields", () => {
  const work = {
    entity: "work_experience", title: "Work experience", fields: [
      name("company"),
      { key: "role", label: "Role", type: "text", required: true, identifier: false, placeholder: null, values: null },
      { key: "description", label: "Description", type: "longtext", required: false, identifier: false, placeholder: null, values: null },
    ],
  };

  it("start from the note, then from what filling found", () => {
    expect(startingValues(work, "Copywriter at Brightside.", null)).toEqual({ company: "Copywriter at Brightside." });
    const fill = { values: { company: "Brightside", role: "Copywriter", description: "Copywriter at Brightside." } };
    expect(startingValues(work, "Copywriter at Brightside.", fill)).toEqual(fill.values);
  });

  it("hold Promote until the required ones are there, and send only what was given", () => {
    expect(missingRequired(work, { company: "Brightside", role: "  " }).map((f) => f.key)).toEqual(["role"]);
    expect(promotedData({ company: " Brightside ", role: "", description: null })).toEqual({ company: "Brightside" });
  });

  it("are drawn as the manifest describes them, and say what is still needed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    function Work() {
      const [promoting, setPromoting] = useState({
        row: { id: "p9", note: "Copywriter at Brightside." }, section: "profile", entity: "work_experience",
        values: { company: "Brightside" }, fills: { "profile.work_experience": { values: { company: "Brightside" }, confidence: { company: 0.96 } } },
      });
      return (
        <PromoteDialog promoting={promoting} onChange={setPromoting} onCancel={vi.fn()}
          onConfirm={() => onConfirm(promoting.values)}
          promotable={[{ key: "profile", title: "Profile", targets: [work] }]} />
      );
    }
    render(<Work />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Filled in from the observation/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Company/)).toHaveValue("Brightside");
    expect(within(dialog).getByText("Still needed: Role.")).toBeInTheDocument();
    const promote = within(dialog).getByRole("button", { name: /^promote$/i });
    expect(promote).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/^Role/), "Copywriter");
    // Typed into, the form is the reader's, and no longer says it was filled.
    expect(within(dialog).queryByText(/Filled in from the observation/)).not.toBeInTheDocument();
    await user.click(promote);
    expect(onConfirm).toHaveBeenCalledWith({ company: "Brightside", role: "Copywriter" });
  });
});

