import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api.js", () => ({
  getProvenance: vi.fn(),
  keepEntry: vi.fn(),
  proposalsFor: vi.fn(() =>
    Promise.resolve([{ rationale: "Mentioned training twice.", evidence: "I signed up for the Great North Run" }]),
  ),
}));

import * as api from "@/lib/api.js";
import ListRenderer from "./ListRenderer";
import { ProvenanceContext, forgetProvenance, useSectionProvenance } from "./provenance";

const node = {
  kind: "list",
  path: ["goals"],
  element: { entity: "goal", identifier: "title", fields: [{ name: "title", role: "title" }] },
};
const items = [
  { id: "goal_1", title: "Run a half marathon" },
  { id: "goal_2", title: "Ship MyGist v3" },
  { id: "goal_3", title: "Learn French" },
];
const entries = {
  goal_1: {
    stale: true, checked: "2026-02-14", updated_at: "2026-02-14",
    added: { by: "Cursor", via: "review", at: "2026-01-03" },
    changed: { by: "", via: "editor", at: "2026-02-14" },
  },
  goal_2: { stale: false, updated_at: "2026-09-01", added: null, changed: null },
  goal_3: {
    stale: false, updated_at: "2026-09-20",
    added: { by: "", via: "editor", at: "2026-01-03" },
    changed: { by: "Claude", via: "review", at: "2026-09-20" },
  },
};

function renderList(keep = vi.fn(() => Promise.resolve())) {
  render(
    <ProvenanceContext.Provider value={{ entries, keep }}>
      <ListRenderer node={node} items={items} onItems={() => {}} />
    </ProvenanceContext.Provider>,
  );
  return keep;
}

describe("provenance in the editor", () => {
  it("marks a stale row and narrows the list to stale rows from its header", async () => {
    const user = userEvent.setup();
    renderList();
    expect(screen.getAllByText("Stale")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "1 stale" }));
    expect(screen.queryByText("Ship MyGist v3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Ship MyGist v3")).toBeInTheDocument();
  });

  it("says who added and changed an opened entry, why, and offers Keep when stale", async () => {
    const user = userEvent.setup();
    const keep = renderList();
    await user.click(screen.getByRole("button", { name: /^Run a half marathon/ }));
    expect(screen.getByText(/^Added by Cursor via Review, 3 January 2026 · changed by you, 14 February 2026/)).toBeInTheDocument();
    expect(screen.getByText("Unchanged since 14 February 2026.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Why?" }));
    expect(await screen.findByText(/I signed up for the Great North Run/)).toBeInTheDocument();
    expect(api.proposalsFor).toHaveBeenCalledWith("goal_1");

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(keep).toHaveBeenCalledWith("goal_1");
  });

  it("explains a change approved in Review, not only an addition", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: /^Learn French/ }));
    await user.click(screen.getByRole("button", { name: "Why?" }));
    expect(api.proposalsFor).toHaveBeenCalledWith("goal_3");
  });

  it("falls back to the last change for an entry older than the record", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("button", { name: /^Ship MyGist v3/ }));
    expect(screen.getByText("Last changed 1 September 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep" })).not.toBeInTheDocument();
  });
});

// Going back to a section must not fetch its record again; a save, or App
// forgetting it, must.
describe("a section's provenance between visits", () => {
  beforeEach(() => {
    forgetProvenance();
    api.getProvenance.mockReset();
    api.getProvenance.mockResolvedValue({ entries });
  });

  it("is fetched on the first open only", async () => {
    const first = renderHook(() => useSectionProvenance("goals", 1));
    await waitFor(() => expect(first.result.current.entries).toEqual(entries));
    first.unmount();

    const again = renderHook(() => useSectionProvenance("goals", 1));
    expect(again.result.current.entries).toEqual(entries);
    expect(api.getProvenance).toHaveBeenCalledTimes(1);
  });

  it("is fetched again after a save, or once forgotten", async () => {
    const open = renderHook(({ savedAt }) => useSectionProvenance("goals", savedAt), {
      initialProps: { savedAt: 1 },
    });
    await waitFor(() => expect(api.getProvenance).toHaveBeenCalledTimes(1));
    open.rerender({ savedAt: 2 });
    await waitFor(() => expect(api.getProvenance).toHaveBeenCalledTimes(2));
    open.unmount();

    forgetProvenance("goals");
    renderHook(() => useSectionProvenance("goals", 2));
    await waitFor(() => expect(api.getProvenance).toHaveBeenCalledTimes(3));
  });
});
