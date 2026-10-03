import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalsPanel, { approvedMany } from "./ProposalsPanel";
import realPacks from "@/__fixtures__/packs.json";

const textField = (key) => ({
  key, label: key.charAt(0).toUpperCase() + key.slice(1), type: "text", required: true,
  identifier: true, placeholder: null, values: null,
});
const PACKS = [
  {
    key: "lifestyle", title: "Lifestyle", enabled: true,
    entities: {
      hobby: { actions: ["add", "update", "remove"], required: ["name"], optional: ["notes"], identifier: "name" },
      value: { actions: ["add", "remove"], required: ["value"], optional: [], identifier: "value" },
      // nested: needs an owning row, so it cannot take a bare note
      hobby_specific: { actions: ["add"], required: ["hobby_name", "specific"], identifier: "specific", parent: "hobby_name" },
    },

    // What the server says a note can become (pack_loader.derive_promotion_targets).
    promotable: [
      { entity: "hobby", title: "Hobby", fields: [textField("name")] },
      { entity: "value", title: "Value", fields: [textField("value")] },
    ],
  },
  {
    key: "knowledge", title: "Knowledge", enabled: true,
    entities: {
      mental_tab: { actions: ["add", "remove"], required: ["title"], optional: ["tags"], identifier: "title" },
    },

    promotable: [{ entity: "mental_tab", title: "Mental tab", fields: [textField("title")] }],
  },
];

const getWatchtower = vi.hoisted(() => vi.fn(() => Promise.resolve({ connection: { state: "none", total: 0 } })));
vi.mock("@/lib/watchtower.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getWatchtower,
}));

const guide = vi.hoisted(() => ({
  startTour: vi.fn(async () => true),
  showHint: vi.fn(async () => true),
  celebrateFirst: vi.fn(async () => {}),
  TOURS: { firstSuggestion: [{ element: '[data-guide="approve"]' }] },
  HINTS: { promote: { element: '[data-guide="promote"]' } },
}));
vi.mock("@/lib/guide.js", () => guide);

vi.mock("@/lib/api", () => ({
  listProposals: vi.fn(),
  listConnectedApps: vi.fn(() => Promise.resolve([])),
  listTokens: vi.fn(() => Promise.resolve([])),
  proposalCount: vi.fn(() => Promise.resolve({ entity: 1, note: 1, total: 2 })),
  approveProposal: vi.fn(() => Promise.resolve({ status: "approved", section: "knowledge" })),
  rejectProposal: vi.fn(() => Promise.resolve({ status: "rejected", section: null })),
  promoteProposal: vi.fn(() => Promise.resolve({ status: "promoted", section: "lifestyle" })),
  suggestDestinations: vi.fn(() => Promise.resolve({ enabled: false, suggestions: [], confident: false })),
  fillFields: vi.fn(() => Promise.resolve({ enabled: false, values: {}, confidence: {} })),
  listStale: vi.fn(() => Promise.resolve([])),
  keepEntry: vi.fn(() => Promise.resolve({ status: "kept" })),
}));

// Returns a handle, as the real one does: a pending reject keeps it to dismiss.
const toast = vi.fn(() => ({ dismiss: vi.fn() }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast }) }));

import * as api from "@/lib/api";

const ENTITY = {
  id: "p1", kind: "entity", action: "update", entity: "domain",
  data: { name: "Datadog", level: "advanced" },
  rationale: "Runs the on-call dashboards unaided now.",
  evidence: "I rebuilt the whole alerting setup myself",
  proposed_by: "Cursor", seen_count: 2, confidence: 0.7,
};

const NOTE = {
  id: "p2", kind: "note", note: "Wants the recommendation first.",
  section_hint: "preferences", rationale: "Said so repeatedly.",
  evidence: "just tell me which one you'd pick",
  proposed_by: "Claude Desktop", seen_count: 1,
};

// Approve, Reject and Delete are sent when the toast carrying their Undo
// goes. In the app Radix closes it after its duration; here this closes the
// latest one waiting to be told.
const closeToast = () => act(async () => {
  toast.mock.calls.map(([props]) => props).filter((p) => p.onClose).at(-1)?.onClose();
});
const withToast = (fn) => async () => fn({ user: userEvent.setup(), pass: closeToast });

beforeEach(() => {
  vi.clearAllMocks();
  toast.mockClear();
  api.listProposals.mockImplementation((kind) =>
    Promise.resolve(kind === "entity" ? [ENTITY] : [NOTE]),
  );
});

describe("ProposalsPanel and the sections it compares against", () => {
  it("asks for the section an update is shown against", async () => {
    // The page fetches sections as they are needed, so the panel has to ask
    // for the one holding the entry this update would change.
    const onNeedSections = vi.fn();
    render(<ProposalsPanel packs={realPacks} onNeedSections={onNeedSections} />);
    await screen.findByRole("button", { name: /^approve /i });
    expect(onNeedSections).toHaveBeenCalledWith(["knowledge"]);
  });
});

describe("ProposalsPanel guides", () => {
  it("starts the first-suggestion guide once suggestions are listed", async () => {
    render(<ProposalsPanel />);
    await screen.findByRole("button", { name: /^approve /i });
    await waitFor(() =>
      expect(guide.startTour).toHaveBeenCalledWith("guide:first-suggestion", guide.TOURS.firstSuggestion),
    );
  });

  it("does not start it over an empty queue", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    await screen.findByText(/nothing waiting/i);
    expect(guide.startTour).not.toHaveBeenCalled();
  });

  it("celebrates the first approval", async () => {
    render(<ProposalsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^approve /i }));
    expect(guide.celebrateFirst).toHaveBeenCalled();
  });

  it("marks the buttons the guide points at", async () => {
    render(<ProposalsPanel />);
    const approve = await screen.findByRole("button", { name: /^approve /i });
    expect(approve).toHaveAttribute("data-guide", "approve");
    expect(screen.getByRole("button", { name: /^reject /i })).toHaveAttribute("data-guide", "reject");
  });
});

describe("ProposalsPanel", () => {
  // The chevron's name carries the row's value, so a queue of a dozen rows
  // does not offer a dozen buttons called "Details".
  const expandRow = async (user) =>
    user.click(await screen.findByRole("button", { name: /^details for /i }));

  it("shows the rationale and the evidence, not just the change", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await expandRow(user);
    expect(screen.getByText(/Runs the on-call dashboards unaided/)).toBeInTheDocument();
    expect(screen.getByText(/I rebuilt the whole alerting setup myself/)).toBeInTheDocument();
  });

  it("renders the change as fields, never as raw JSON", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    // The whole point of this surface is that a person reads it and decides.
    expect(await screen.findByText("Update")).toBeInTheDocument();
    // No packs here, so the place falls back to the storage name.
    expect(screen.getByText(/domain/)).toBeInTheDocument();
    await expandRow(user);
    expect(screen.getByText("Name")).toBeInTheDocument();
    // Twice over once expanded: the row's own line and the field list.
    expect(screen.getAllByText("Datadog").length).toBeGreaterThan(0);
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(screen.getByText("advanced")).toBeInTheDocument();
    expect(screen.queryByText(/[{}"]/)).not.toBeInTheDocument();
  });

  it("reads snake_case keys as words", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "work_experience", data: { company: "Acme", start_date: "2026-01" } }]
        : []),
    );
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    expect(await screen.findByText(/work experience/)).toBeInTheDocument();
    await expandRow(user);
    expect(screen.getByText("Start date")).toBeInTheDocument();
  });

  it("names the tool that proposed it, and where the change goes, without being expanded", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity" ? [{ ...ENTITY, entity: "hobby", data: { name: "bouldering" } }] : []),
    );
    render(<ProposalsPanel packs={PACKS} />);
    // The section's name, not the storage word "hobby".
    expect(await screen.findByText(/Lifestyle · from Cursor/)).toBeInTheDocument();
  });

  it("shows how many tools raised the same thing", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await expandRow(user);
    expect(screen.getByText(/seen 2×/)).toBeInTheDocument();
  });

  it("says how much is waiting in the queue you are not looking at", async () => {
    api.proposalCount.mockResolvedValue({ entity: 3, note: 2, total: 5 });
    render(<ProposalsPanel />);
    expect(await screen.findByRole("tab", { name: /inbox 3/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /observations 2/i })).toBeInTheDocument();
  });

  it("counts without marking anything seen", async () => {
    // listProposals marks rows seen server-side, which is what protects them
    // from eviction. The badge must never be the thing that strips that.
    render(<ProposalsPanel />);
    await waitFor(() => expect(api.proposalCount).toHaveBeenCalled());
    expect(api.listProposals).toHaveBeenCalledTimes(1);
    expect(api.listProposals).toHaveBeenCalledWith("entity");
  });

  it("tells the app the new total, so the sidebar dot needs no fetch of its own", async () => {
    const user = userEvent.setup();
    const onCounts = vi.fn();
    // Set explicitly: clearAllMocks does not undo a mockResolvedValue, so the
    // test above would otherwise hand this one its 5.
    api.proposalCount.mockResolvedValue({ entity: 1, note: 1, total: 2 });
    render(<ProposalsPanel onCounts={onCounts} />);
    await waitFor(() => expect(onCounts).toHaveBeenCalledWith(2));
    api.proposalCount.mockResolvedValue({ entity: 0, note: 1, total: 1 });
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(onCounts).toHaveBeenCalledWith(1));
  });

  it("says what the change is without being expanded", async () => {
    // hobby's identifier is `name`, and `notes` is the one other field with a
    // value, so the line reads the identifier and what it becomes. Approving
    // must not require opening anything.
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "hobby", data: { name: "bouldering", notes: "twice a week" } }]
        : []),
    );
    render(<ProposalsPanel packs={PACKS} />);
    expect(await screen.findByText(/bouldering/)).toBeInTheDocument();
    expect(screen.getByText(/twice a week/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve bouldering$/i })).toBeInTheDocument();
    // The reason and the reader's own words are on the face: together they
    // are the case for approving.
    expect(screen.getByText(/Runs the on-call dashboards/)).toBeInTheDocument();
    expect(screen.getByText(/rebuilt the whole alerting/)).toHaveClass("line-clamp-3");
  });

  it("shows what an update replaces, rather than an arrow that reads like a rename", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "goal", data: { title: "Speak French", notes: "Weekly tutor." } }]
        : []),
    );
    const user = userEvent.setup();
    const packData = { goals: { goals: [{ id: "g1", title: "Speak French", notes: "Paused for now." }] } };
    render(<ProposalsPanel packs={realPacks} packData={packData} />);
    const line = (await screen.findByText("Paused for now.")).closest("p");
    expect(line).toHaveTextContent("Notes: Paused for now. → becomes Weekly tutor.");
    expect(screen.getByText("Speak French")).toHaveTextContent(/^Speak French$/);
    // Opened, the field list says the same, and editing shows what is there now.
    await expandRow(user);
    expect(screen.getAllByText("Paused for now.")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    expect(screen.getByText("Now: Paused for now.")).toBeInTheDocument();
  });

  it("counts the fields it cannot fit rather than truncating them away", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "hobby",
             data: { name: "bouldering", notes: "twice a week", level: "keen" } }]
        : []),
    );
    render(<ProposalsPanel packs={PACKS} />);
    expect(await screen.findByText(/\+2 more/)).toBeInTheDocument();
  });

  it("tints approve and reject at the same weight", async () => {
    // A red reject beside a neutral approve pulls the eye down the reject
    // column, which is the wrong emphasis for the action taken most.
    render(<ProposalsPanel />);
    // The darker green: --success measured 3.5:1 as text on the page.
    expect(await screen.findByRole("button", { name: /^approve /i }))
      .toHaveClass("text-emerald-700");
    expect(screen.getByRole("button", { name: /^reject /i }))
      .toHaveClass("text-destructive");
  });

  it("marks reject as destructive, and lets that beat the ghost variant", async () => {
    render(<ProposalsPanel />);
    const reject = await screen.findByRole("button", { name: /^reject /i });
    expect(reject.className).toContain("text-destructive");
    // The real risk is not the class being absent, it is the class losing.
    // `ghost` ships hover:text-accent-foreground, and two utilities of equal
    // specificity are settled by CSS source order, not by the order they are
    // passed -- which is how headline-3 shipped at the wrong weight in slice
    // 2b. cn() runs twMerge, so the loser should be gone from the list
    // entirely rather than sitting there hoping to win the cascade.
    expect(reject.className).not.toContain("hover:text-accent-foreground");
  });

  it("approves and drops the row, once the Undo window has passed", withToast(async ({ user, pass }) => {
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    // Gone from the queue at once, but not yet written.
    expect(screen.queryByText(/Runs the on-call dashboards/)).not.toBeInTheDocument();
    expect(api.approveProposal).not.toHaveBeenCalled();
    await pass();
    expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined);
  }));

  it("keeps Undo working for as long as its toast stands", async () => {
    // Radix pauses a toast while the pointer is on it. A timer of the panel's
    // own used to send the decision at 8s regardless, leaving an Undo that did
    // nothing. Nothing is sent until the toast goes.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ProposalsPanel />);
      await user.click(await screen.findByRole("button", { name: /^approve /i }));
      expect(toast.mock.calls.at(-1)[0].duration).toBe(8000);
      await act(async () => { vi.advanceTimersByTime(20000); });
      expect(api.approveProposal).not.toHaveBeenCalled();
      act(() => toast.mock.calls.at(-1)[0].action.props.onClick());
      expect(screen.getByRole("button", { name: /^approve /i })).toBeInTheDocument();
      await closeToast();
      expect(api.approveProposal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts an approved row back on Undo, and never writes it", withToast(async ({ user, pass }) => {
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    const { action } = toast.mock.calls.at(-1)[0];
    expect(action.props.altText).toBe("Undo");
    act(() => action.props.onClick());
    expect(screen.getByRole("button", { name: /^approve /i })).toBeInTheDocument();
    await pass();
    expect(api.approveProposal).not.toHaveBeenCalled();
  }));

  it("sends a waiting approval straight away when Review is left, and refreshes its section", async () => {
    const user = userEvent.setup();
    const onSectionChanged = vi.fn();
    const { unmount } = render(<ProposalsPanel onSectionChanged={onSectionChanged} />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    expect(api.approveProposal).not.toHaveBeenCalled();
    unmount();
    // Behind any decision already going out, so on the next tick, not in the
    // unmount itself.
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined));
    await waitFor(() => expect(onSectionChanged).toHaveBeenCalledWith("knowledge"));
  });

  it("approves with the reader's corrections when a row is edited first", withToast(async ({ user, pass }) => {
    render(<ProposalsPanel />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    const level = screen.getByLabelText("Level");
    await user.clear(level);
    await user.type(level, "expert");
    await user.click(screen.getByRole("button", { name: "Approve with changes" }));
    expect(toast.mock.calls.at(-1)[0].title).toMatch(/with your changes/);

    await pass();
    expect(api.approveProposal).toHaveBeenCalledWith("p1", { name: "Datadog", level: "expert" });
  }));

  it("edits a list as one comma-separated line, and sends it back as a list", withToast(async ({ user, pass }) => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "mental_tab", data: { title: "Cafes", tags: ["food", "newcastle"] } }]
        : []),
    );
    render(<ProposalsPanel packs={PACKS} />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    const tags = screen.getByLabelText("Tags");
    expect(tags).toHaveValue("food, newcastle");
    await user.clear(tags);
    await user.type(tags, "food,  coffee ,, ");
    await user.click(screen.getByRole("button", { name: "Approve with changes" }));

    await pass();
    expect(api.approveProposal).toHaveBeenCalledWith("p1", { title: "Cafes", tags: ["food", "coffee"] });
  }));

  it("approves as proposed when the edit is discarded", withToast(async ({ user, pass }) => {
    render(<ProposalsPanel />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    await user.type(screen.getByLabelText("Level"), "!!");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("button", { name: /^approve /i }));

    await pass();
    expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined);
  }));

  it("rejects without writing anything, once the Undo window has passed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ProposalsPanel />);
      await user.click(await screen.findByRole("button", { name: /^reject /i }));
      // Gone from the queue at once, but not yet sent.
      expect(screen.queryByRole("button", { name: /^reject /i })).not.toBeInTheDocument();
      expect(api.rejectProposal).not.toHaveBeenCalled();
      await closeToast();
      expect(api.rejectProposal).toHaveBeenCalledWith("p1");
      expect(api.approveProposal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a rejected row back on Undo, and never sends the rejection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ProposalsPanel />);
      await user.click(await screen.findByRole("button", { name: /^reject /i }));
      // The badge follows the rows on screen, not the server, until it is sent.
      expect(screen.getByRole("tab", { name: /inbox/i })).not.toHaveTextContent("1");
      const { action } = toast.mock.calls.at(-1)[0];
      expect(action.props.altText).toBe("Undo");
      act(() => action.props.onClick());
      expect(screen.getByRole("button", { name: /^reject /i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /inbox/i })).toHaveTextContent("1");
      await closeToast();
      expect(api.rejectProposal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a rejected row off the badge when the poll lands inside its Undo window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      api.proposalCount.mockResolvedValue({ entity: 1, note: 1, total: 2 });
      render(<ProposalsPanel />);
      const reject = await screen.findByRole("button", { name: /^reject /i });
      expect(screen.getByRole("tab", { name: /inbox/i })).toHaveTextContent("1");
      await act(async () => { vi.advanceTimersByTime(10000); });
      await user.click(reject);
      // The 15s poll lands 5s in. The server still counts the row, and lists it.
      await act(async () => { vi.advanceTimersByTime(6000); });
      expect(api.proposalCount.mock.calls.length).toBeGreaterThan(1);
      expect(screen.getByRole("tab", { name: /inbox/i })).not.toHaveTextContent("1");
      expect(screen.queryByRole("button", { name: /^reject /i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists stale entries in their own tab, with Keep and a way to the section", async () => {
    const user = userEvent.setup();
    const onViewSection = vi.fn();
    api.listStale.mockResolvedValue([
      { section: "goals", id: "goal_1", title: "Run a half marathon", since: "2026-02-14" },
    ]);
    api.proposalCount.mockResolvedValue({ entity: 1, note: 1, total: 2 });
    const onCounts = vi.fn();
    render(
      <ProposalsPanel onViewSection={onViewSection} onCounts={onCounts} sectionTitles={{ goals: "Goals" }} />,
    );
    // Counted on its tab, but never handed up to the rail with the suggestions.
    expect(await screen.findByRole("tab", { name: /stale 1/i })).toBeInTheDocument();
    expect(onCounts).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByRole("tab", { name: /stale/i }));
    expect(await screen.findByText("Unchanged since 14 February 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open in Goals" }));
    expect(onViewSection).toHaveBeenCalledWith("goals", "goal_1");

    await user.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(api.keepEntry).toHaveBeenCalledWith("goal_1"));
    await waitFor(() => expect(screen.queryByText("Run a half marathon")).not.toBeInTheDocument());
    api.listStale.mockResolvedValue([]);
  });

  describe("several at once, and from the keyboard", () => {
    const three = ["Datadog", "Grafana", "Sentry"].map((name, i) => ({
      ...ENTITY, id: `p${i + 10}`, data: { name, level: "advanced" },
    }));
    beforeEach(() => {
      api.listProposals.mockImplementation((kind) => Promise.resolve(kind === "entity" ? three : []));
    });
    const names = () =>
      screen.getAllByRole("button", { name: /^approve /i }).map((b) => b.getAttribute("aria-label"));

    it("rejects a selection with one Undo that brings them all back, in order", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<ProposalsPanel />);
        await user.click(await screen.findByRole("checkbox", { name: "Select Datadog" }));
        await user.click(screen.getByRole("checkbox", { name: "Select Sentry" }));
        await user.click(screen.getByRole("button", { name: "Reject 2" }));
        expect(names()).toEqual(["Approve Grafana"]);

        const { title, action } = toast.mock.calls.at(-1)[0];
        expect(title).toBe("Rejected 2. They won't be suggested again.");
        act(() => action.props.onClick());
        expect(names()).toEqual(["Approve Datadog", "Approve Grafana", "Approve Sentry"]);
        await closeToast();
        expect(api.rejectProposal).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("approves a selection one at a time, after one Undo, and brings back whichever failed", withToast(async ({ user, pass }) => {
      api.approveProposal.mockImplementation((id) =>
        id === "p11" ? Promise.reject(new Error("no")) : Promise.resolve({ status: "approved" }));
      render(<ProposalsPanel />);
      await user.click(await screen.findByRole("checkbox", { name: /select all/i }));
      await user.click(screen.getByRole("button", { name: "Approve 3" }));
      expect(screen.queryAllByRole("button", { name: /^approve /i })).toEqual([]);
      expect(toast.mock.calls.at(-1)[0].title).toBe("Updated 3 in your persona");

      await pass();
      await waitFor(() => expect(names()).toEqual(["Approve Grafana"]));
      expect(api.approveProposal.mock.calls.map((c) => c[0])).toEqual(["p10", "p11", "p12"]);
      expect(toast.mock.calls.at(-1)[0]).toMatchObject({
        title: "That did not go through",
        description: "The item is back in the queue.",
        variant: "destructive",
      });
      api.approveProposal.mockImplementation(() => Promise.resolve({ status: "approved", section: "knowledge" }));
    }));

    it("drops a row from the selection once you start editing it", async () => {
      const user = userEvent.setup();
      render(<ProposalsPanel />);
      const box = await screen.findByRole("checkbox", { name: "Select Datadog" });
      await user.click(box);
      await user.click(screen.getByRole("button", { name: "Details for Datadog" }));
      await user.click(screen.getByRole("button", { name: "Edit before approving" }));
      expect(box).not.toBeChecked();
      expect(box).toBeDisabled();
      expect(screen.queryByRole("region", { name: "Selected" })).not.toBeInTheDocument();
    });

    it("moves with j and approves with a, then lands on the next row", withToast(async ({ user, pass }) => {
      render(<ProposalsPanel />);
      const rows = await screen.findAllByRole("group", { name: /^update /i });
      expect(rows[0]).toHaveAccessibleDescription(/a to approve, r to reject/);
      rows[0].focus();
      await user.keyboard("j");
      expect(rows[1]).toHaveFocus();
      await user.keyboard("a");
      await waitFor(() => expect(screen.getByRole("group", { name: "Update Sentry" })).toHaveFocus());
      await pass();
      expect(api.approveProposal).toHaveBeenCalledWith("p11", undefined);
    }));

    it("answers ? and j before any row has focus, and leaves the arrow keys to the page", async () => {
      const user = userEvent.setup();
      render(<ProposalsPanel />);
      const rows = await screen.findAllByRole("group", { name: /^update /i });
      expect(document.body).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(document.body).toHaveFocus();
      await user.keyboard("j");
      expect(rows[0]).toHaveFocus();
      rows[0].blur();
      await user.keyboard("?");
      expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });

    it("leaves letters typed into an edit field alone", async () => {
      const user = userEvent.setup();
      render(<ProposalsPanel />);
      const [row] = await screen.findAllByRole("group", { name: /^update /i });
      row.focus();
      await user.keyboard("e");
      await user.type(screen.getByLabelText("Level"), "ar");
      expect(api.approveProposal).not.toHaveBeenCalled();
      expect(api.rejectProposal).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Level")).toHaveValue("advancedar");
    });
  });

  it("sends a waiting rejection straight away when Review is left", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^reject /i }));
    expect(api.rejectProposal).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith("p1"));
  });

  it("sends stacked decisions one after another, never two at once", async () => {
    // Each keeps its own toast, so two can go at the same moment; two writes
    // to one section landing together could lose one.
    let finish = () => {};
    api.approveProposal.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    api.listProposals.mockImplementation((kind) => Promise.resolve(kind === "entity"
      ? [ENTITY, { ...ENTITY, id: "p9", data: { name: "Sentry", level: "expert" } }]
      : [NOTE]));
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve datadog/i }));
    await user.click(await screen.findByRole("button", { name: /^approve sentry/i }));
    await act(async () => {
      for (const [props] of toast.mock.calls) props.onClose?.();
    });
    try {
      await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(1));
    } finally {
      // The queue is module-wide: left hanging, it would hold up every later
      // test's decisions too.
      await act(async () => finish({ status: "approved", section: "knowledge" }));
    }
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(2));
  });

  it("offers promote and delete on observations, never approve", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(screen.getByRole("tab", { name: /observations/i }));
    // Named with the note, as approve and reject are with the value.
    expect(await screen.findByRole("button", { name: "Promote Wants the recommendation first." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Wants the recommendation first." })).toBeInTheDocument();
    expect(screen.getByText("Observation").closest("p"))
      .toHaveTextContent("Observation · suggested for preferences · from Claude Desktop");
    expect(screen.queryByRole("button", { name: /^approve /i })).not.toBeInTheDocument();
  });

  it("names what it rejected or deleted, quoting a note", async () => {
    const user = userEvent.setup();
    const packs = [{ key: "knowledge", title: "Knowledge", entities: { domain: { identifier: "name" } } }];
    render(<ProposalsPanel packs={packs} />);
    await user.click(await screen.findByRole("button", { name: /^reject /i }));
    expect(toast.mock.calls.at(-1)[0].title).toBe("Rejected Datadog. It won't be suggested again.");

    await user.click(screen.getByRole("tab", { name: /observations/i }));
    await user.click(await screen.findByRole("button", { name: /^delete /i }));
    expect(toast.mock.calls.at(-1)[0].title)
      .toBe("Deleted “Wants the recommendation first”. It won't be suggested again.");
  });

  it("counts a bulk approval by what each does", () => {
    const rows = (...actions) => actions.map((action) => ({ action }));
    expect(approvedMany(rows("add", "add"))).toBe("Added 2 to your persona");
    expect(approvedMany(rows("update", "update", "update"))).toBe("Updated 3 in your persona");
    expect(approvedMany(rows("add", "update", "update", "add"))).toBe("Approved 4: 2 added, 2 updated");
  });

  it("offers a way to see what changed beside the Undo, naming where it went", async () => {
    const user = userEvent.setup();
    const onViewSection = vi.fn();
    // The section comes from the pack that declares the entity, since the
    // toast shows before the server has said anything.
    const packs = [{ key: "knowledge", title: "Knowledge", entities: { domain: { identifier: "name" } } }];
    render(
      <ProposalsPanel packs={packs} onViewSection={onViewSection} sectionTitles={{ knowledge: "Knowledge" }} />,
    );
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    const { title, action, duration } = toast.mock.calls[0][0];
    expect(title).toBe("Datadog updated in Knowledge");
    // A link nobody has time to click is not a link. The default is 5s.
    expect(duration).toBeGreaterThan(5000);
    render(action);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view in knowledge/i }));
    expect(onViewSection).toHaveBeenCalledWith("knowledge");
  });

  describe("promotion asks where it should go", () => {
    async function openPromoteDialog(user, props = {}) {
      render(<ProposalsPanel packs={PACKS} sectionTitles={{ lifestyle: "Lifestyle" }} {...props} />);
      await user.click(screen.getByRole("tab", { name: /observations/i }));
      await user.click(await screen.findByRole("button", { name: /^promote /i }));
      return screen.findByRole("dialog");
    }

    // Which types a note can become is the server's rule, tested there
    // (tests/test_promotion_targets.py); the panel only lists what it serves.

    it("files where Jev is sure, unless you have chosen first", async () => {
      api.suggestDestinations.mockResolvedValueOnce({ enabled: true, confident: true, suggestions: [
        { section: "knowledge", entity: "mental_tab", probability: 0.95 },
        { section: "lifestyle", entity: "value", probability: 0.03 },
      ] });
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await waitFor(() => expect(within(dialog).getByLabelText(/^section$/i)).toHaveTextContent("Knowledge"));
      expect(within(dialog).getByLabelText(/^type$/i)).toHaveTextContent("Mental tab");
      expect(within(dialog).getByRole("group", { name: "Suggested" })).toBeInTheDocument();
      expect(api.suggestDestinations).toHaveBeenCalledWith("p2");
    });

    it("only suggests when Jev is unsure, and never overrides a choice already made", async () => {
      let answer;
      api.suggestDestinations.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      // It opens on Lifestyle, the first section a note can go to.
      await pick(user, dialog, /section/i, "Knowledge");
      await act(async () => answer({ enabled: true, confident: true, suggestions: [
        { section: "lifestyle", entity: "value", probability: 0.97 },
      ] }));
      expect(within(dialog).getByLabelText(/^section$/i)).toHaveTextContent("Knowledge");
      expect(within(dialog).getByRole("group", { name: "Suggested" })).toBeInTheDocument();
    });

    it("does not file anything until you confirm", async () => {
      const user = userEvent.setup();
      await openPromoteDialog(user);
      expect(api.promoteProposal).not.toHaveBeenCalled();
    });

    it("defaults to the section the agent suggested", async () => {
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      // NOTE's section_hint is "preferences", which has no valid target here,
      // so it falls back rather than silently filing somewhere wrong.
      expect(within(dialog).getByLabelText(/section/i)).toBeInTheDocument();
    });

    // A Radix Select is a button, not a <select>, so selectOptions no longer
    // applies. The listbox is portalled outside the dialog, which is why the
    // option is found through `screen` rather than `within(dialog)`.
    async function pick(user, dialog, labelText, optionName) {
      await user.click(within(dialog).getByLabelText(labelText));
      await user.click(await screen.findByRole("option", { name: optionName }));
    }

    it("promotes into the entity you picked, under its own field", async () => {
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await pick(user, dialog, /section/i, "Lifestyle");
      await pick(user, dialog, /^type$/i, "Value");
      await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
      await waitFor(() =>
        expect(api.promoteProposal).toHaveBeenCalledWith(
          "p2", "value", { value: "Wants the recommendation first." }),
      );
    });

    it("lets you edit the wording before it becomes real data", async () => {
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await pick(user, dialog, /section/i, "Knowledge");
      const field = within(dialog).getByLabelText(/^title$/i);
      await user.clear(field);
      await user.type(field, "Recommendation first");
      await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
      await waitFor(() =>
        expect(api.promoteProposal).toHaveBeenCalledWith(
          "p2", "mental_tab", { title: "Recommendation first" }),
      );
    });

    it("fills the chosen type's fields from the observation, and promotes those", async () => {
      api.fillFields.mockResolvedValueOnce({ enabled: true, values: { title: "Recommendation first" }, confidence: { title: 0.9 } });
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await pick(user, dialog, /section/i, "Knowledge");
      await waitFor(() => expect(within(dialog).getByLabelText(/^title$/i)).toHaveValue("Recommendation first"));
      expect(api.fillFields).toHaveBeenCalledWith("p2", "knowledge", "mental_tab");
      await user.click(within(dialog).getByRole("button", { name: /^promote$/i }));
      await waitFor(() =>
        expect(api.promoteProposal).toHaveBeenCalledWith("p2", "mental_tab", { title: "Recommendation first" }),
      );
    });

    it("never overwrites what you typed with a fill that arrives late", async () => {
      let answer;
      api.fillFields.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await pick(user, dialog, /section/i, "Knowledge");
      const field = within(dialog).getByLabelText(/^title$/i);
      await user.clear(field);
      await user.type(field, "Mine");
      await act(async () => answer({ enabled: true, values: { title: "Theirs" }, confidence: { title: 0.9 } }));
      expect(field).toHaveValue("Mine");
    });

    it("cancelling files nothing", async () => {
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
      expect(api.promoteProposal).not.toHaveBeenCalled();
    });
  });

  it("tells the app which section to refetch, so the link does not land on stale data", withToast(async ({ user, pass }) => {
    const onSectionChanged = vi.fn();
    render(<ProposalsPanel onSectionChanged={onSectionChanged} />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await pass();
    await waitFor(() => expect(onSectionChanged).toHaveBeenCalledWith("knowledge"));
  }));

  it("does not ask for a refetch when nothing changed", async () => {
    const user = userEvent.setup();
    const onSectionChanged = vi.fn();
    render(<ProposalsPanel onSectionChanged={onSectionChanged} />);
    await user.click(await screen.findByRole("button", { name: /^reject /i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(onSectionChanged).not.toHaveBeenCalled();
  });

  it("picks up proposals that arrive while the tab is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ProposalsPanel />);
      await waitFor(() => expect(api.listProposals).toHaveBeenCalled());
      const before = api.listProposals.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20000);
      expect(api.listProposals.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives rejecting an Undo but no link, because nothing changed", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel onViewSection={vi.fn()} sectionTitles={{}} />);
    await user.click(await screen.findByRole("button", { name: /^reject /i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].action.props.altText).toBe("Undo");
  });

  it("says so when an approval fails, and puts the row back", withToast(async ({ user, pass }) => {
    api.approveProposal.mockRejectedValueOnce(new Error("boom"));
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await pass();
    await waitFor(() => expect(toast.mock.calls.at(-1)[0]).toMatchObject({ variant: "destructive" }));
    // The row is back to try again.
    expect(screen.getByRole("button", { name: /^approve /i })).toBeInTheDocument();
  }));

  it("offers no keyboard shortcuts over an empty tab", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });

  it("says the queue is empty rather than showing nothing", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  describe("an empty queue says which fix applies", () => {
    beforeEach(() => { api.listProposals.mockResolvedValue([]); });
    const connection = (c) => getWatchtower.mockResolvedValue({ connection: { total: 1, kind: "grant", ...c } });

    it("points at the connect flow when nothing is connected", async () => {
      connection({ state: "none", total: 0, kind: null });
      render(<ProposalsPanel />);
      expect(await screen.findByText(/nothing is connected yet/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect an app/i })).toBeInTheDocument();
    });

    it("names the app that can read but not propose", async () => {
      connection({ state: "connected", name: "Claude Desktop", can_propose: false });
      render(<ProposalsPanel />);
      expect(await screen.findByText(
        /Claude Desktop can read your persona but not suggest changes/i)).toBeInTheDocument();
    });

    it("does not name one app when several are connected and none can propose", async () => {
      connection({ state: "connected", name: "Claude Desktop", can_propose: false, total: 2 });
      render(<ProposalsPanel />);
      expect(await screen.findByText(
        /None of your connections can suggest changes/i)).toBeInTheDocument();
    });

    it("says nothing extra when something can propose", async () => {
      connection({ state: "connected", name: "Cursor", can_propose: true });
      render(<ProposalsPanel />);
      expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
      await waitFor(() => expect(getWatchtower).toHaveBeenCalled());
      expect(screen.queryByText(/not suggest changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/nothing is connected/i)).not.toBeInTheDocument();
    });

    it("says a token is waiting for its first call, with its name capitalised", async () => {
      connection({ state: "waiting", name: "my assistant", kind: "token", can_propose: true });
      render(<ProposalsPanel />);
      expect(await screen.findByText(/My assistant is set up but hasn.t been used yet/))
        .toBeInTheDocument();
    });

    it("sends Connect an app to the connect flow", async () => {
      connection({ state: "none", total: 0, kind: null });
      const onConnect = vi.fn();
      render(<ProposalsPanel onConnect={onConnect} />);
      fireEvent.click(await screen.findByRole("button", { name: /connect an app/i }));
      expect(onConnect).toHaveBeenCalled();
    });

    it("opens the tab that manages the read-only connection", async () => {
      connection({ state: "connected", name: "Claude Desktop", can_propose: false });
      const onOpenSettings = vi.fn();
      render(<ProposalsPanel onOpenSettings={onOpenSettings} />);
      fireEvent.click(await screen.findByRole("button", { name: /review access/i }));
      expect(onOpenSettings).toHaveBeenCalledWith("apps");
    });

    it("does not ask about connections while there is something to review", async () => {
      api.listProposals.mockImplementation((kind) =>
        Promise.resolve(kind === "entity" ? [ENTITY] : []));
      render(<ProposalsPanel />);
      await screen.findByRole("button", { name: /^approve /i });
      expect(getWatchtower).not.toHaveBeenCalled();
    });
  });
});
