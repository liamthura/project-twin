import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packs from "@/__fixtures__/packs.json";

vi.mock("@/lib/api.js", () => ({ searchMeaning: vi.fn(() => Promise.resolve([])) }));

import { searchMeaning } from "@/lib/api.js";
import { SearchDialog } from "./SearchDialog";
import ListRenderer from "@/renderers/ListRenderer";
import { FocusEntryContext } from "@/renderers/focusEntry";

const enabled = packs.filter((p) => ["goals", "lifestyle"].includes(p.key));
const data = {
  goals: { goals: [{ id: "goal_1", title: "Lead climb outdoors" }] },
  lifestyle: { hobbies: [{ id: "hobby_1", name: "Bouldering", notes: "Climbing twice a week" }] },
};

function renderDialog(onOpen = vi.fn()) {
  render(<SearchDialog open onOpenChange={() => {}} packs={enabled} packData={data} onOpen={onOpen} />);
  return onOpen;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchMeaning.mockResolvedValue([]);
});

describe("SearchDialog", () => {
  it("finds across sections as you type, and opens the active result with Enter", async () => {
    const user = userEvent.setup();
    const onOpen = renderDialog();
    await user.type(screen.getByRole("combobox"), "climb");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Lead climb outdoors",
      "BoulderingHobbies & activities · Climbing twice a week",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    // The term is marked wherever it shows, title and snippet alike.
    expect([...options[0].querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["climb"]);
    expect([...options[1].querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Climb"]);
    // Each result sits in a group named for its section, so "Lead climb
    // outdoors", which has no detail line, is still read with where it is.
    expect(screen.getByRole("group", { name: "Goals" })).toContainElement(options[0]);
    expect(screen.getByRole("group", { name: "Lifestyle" })).toContainElement(options[1]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ section: "lifestyle", entityId: "hobby_1" }));
  });

  it("adds what the server relates by meaning, never repeating a word match", async () => {
    searchMeaning.mockResolvedValue([
      { entity_id: "goal_1", section: "goals", title: "Lead climb outdoors", snippet: "" },
      { entity_id: "hobby_9", section: "lifestyle", title: "Grip strength basics", snippet: "…hangboard…" },
      { entity_id: "x", section: "media", title: "A section that is turned off", snippet: "" },
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole("combobox"), "climb");
    expect(await screen.findByText("Related by meaning")).toBeInTheDocument();
    expect(screen.getByText("Grip strength basics")).toBeInTheDocument();
    // Split by the match's <mark>, so counted by the option's whole text.
    expect(screen.getAllByRole("option").filter((o) => o.textContent === "Lead climb outdoors"))
      .toHaveLength(1);
    expect(screen.queryByText(/turned off/)).not.toBeInTheDocument();
  });

  it("shows no meaning group when the server has none", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole("combobox"), "climb");
    await waitFor(() => expect(searchMeaning).toHaveBeenCalledWith("climb"));
    expect(screen.queryByText("Related by meaning")).not.toBeInTheDocument();
  });
});

describe("opening an entry from outside the list", () => {
  it("opens that row and says it is done", () => {
    const done = vi.fn();
    const goals = enabled.find((p) => p.key === "goals").sections[0];
    render(
      <FocusEntryContext.Provider value={{ id: "goal_2", done }}>
        <ListRenderer
          node={goals}
          items={[{ id: "goal_1", title: "Ship v3" }, { id: "goal_2", title: "Lead climb outdoors" }]}
          onItems={() => {}}
        />
      </FocusEntryContext.Provider>,
    );
    expect(done).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Lead climb outdoors/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Ship v3/ })).toHaveAttribute("aria-expanded", "false");
  });
});
