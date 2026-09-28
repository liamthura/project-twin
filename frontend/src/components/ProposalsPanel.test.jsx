import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalsPanel from "./ProposalsPanel";
import { promotionTargets } from "./PromoteDialog";

const PACKS = [
  {
    key: "lifestyle", title: "Lifestyle", enabled: true,
    entities: {
      hobby: { actions: ["add", "update", "remove"], required: ["name"], optional: ["notes"], identifier: "name" },
      value: { actions: ["add", "remove"], required: ["value"], optional: [], identifier: "value" },
      // nested: needs an owning row, so it cannot take a bare note
      hobby_specific: { actions: ["add"], required: ["hobby_name", "specific"], identifier: "specific", parent: "hobby_name" },
    },
  },
  {
    key: "knowledge", title: "Knowledge", enabled: true,
    entities: {
      mental_tab: { actions: ["add", "remove"], required: ["title"], optional: ["tags"], identifier: "title" },
    },
  },
];

vi.mock("@/lib/api", () => ({
  listProposals: vi.fn(),
  listConnectedApps: vi.fn(() => Promise.resolve([])),
  listTokens: vi.fn(() => Promise.resolve([])),
  proposalCount: vi.fn(() => Promise.resolve({ entity: 1, note: 1, total: 2 })),
  approveProposal: vi.fn(() => Promise.resolve({ status: "approved", section: "knowledge" })),
  rejectProposal: vi.fn(() => Promise.resolve({ status: "rejected", section: null })),
  promoteProposal: vi.fn(() => Promise.resolve({ status: "promoted", section: "lifestyle" })),
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

beforeEach(() => {
  vi.clearAllMocks();
  toast.mockClear();
  api.listProposals.mockImplementation((kind) =>
    Promise.resolve(kind === "entity" ? [ENTITY] : [NOTE]),
  );
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
    // The reason is on the face: it is the case for approving. The quote
    // stays behind the chevron.
    expect(screen.getByText(/Runs the on-call dashboards/)).toBeInTheDocument();
    expect(screen.queryByText(/rebuilt the whole alerting/)).not.toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: /^approve /i }))
      .toHaveClass("text-success");
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

  it("approves and drops the row", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined));
    await waitFor(() =>
      expect(screen.queryByText(/Runs the on-call dashboards/)).not.toBeInTheDocument(),
    );
  });

  it("approves with the reader's corrections when a row is edited first", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    const level = screen.getByLabelText("Level");
    await user.clear(level);
    await user.type(level, "expert");
    await user.click(screen.getByRole("button", { name: "Approve with changes" }));

    await waitFor(() =>
      expect(api.approveProposal).toHaveBeenCalledWith("p1", { name: "Datadog", level: "expert" }),
    );
    expect(toast.mock.calls.at(-1)[0].title).toMatch(/with your changes/);
  });

  it("edits a list as one comma-separated line, and sends it back as a list", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "mental_tab", data: { title: "Cafes", tags: ["food", "newcastle"] } }]
        : []),
    );
    const user = userEvent.setup();
    render(<ProposalsPanel packs={PACKS} />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    const tags = screen.getByLabelText("Tags");
    expect(tags).toHaveValue("food, newcastle");
    await user.clear(tags);
    await user.type(tags, "food,  coffee ,, ");
    await user.click(screen.getByRole("button", { name: "Approve with changes" }));

    await waitFor(() =>
      expect(api.approveProposal).toHaveBeenCalledWith("p1", { title: "Cafes", tags: ["food", "coffee"] }),
    );
  });

  it("approves as proposed when the edit is discarded", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await expandRow(user);
    await user.click(screen.getByRole("button", { name: "Edit before approving" }));
    await user.type(screen.getByLabelText("Level"), "!!");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("button", { name: /^approve /i }));

    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined));
  });

  it("rejects without writing anything, once the Undo window has passed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ProposalsPanel />);
      await user.click(await screen.findByRole("button", { name: /^reject /i }));
      // Gone from the queue at once, but not yet sent.
      expect(screen.queryByRole("button", { name: /^reject /i })).not.toBeInTheDocument();
      expect(api.rejectProposal).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(8000); });
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
      await act(async () => { vi.advanceTimersByTime(8000); });
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
    expect(onViewSection).toHaveBeenCalledWith("goals");

    await user.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(api.keepEntry).toHaveBeenCalledWith("goal_1"));
    await waitFor(() => expect(screen.queryByText("Run a half marathon")).not.toBeInTheDocument());
    api.listStale.mockResolvedValue([]);
  });

  it("sends a waiting rejection straight away when Review is left", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^reject /i }));
    expect(api.rejectProposal).not.toHaveBeenCalled();
    unmount();
    expect(api.rejectProposal).toHaveBeenCalledWith("p1");
  });

  it("offers promote and delete on observations, never approve", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(screen.getByRole("tab", { name: /observations/i }));
    expect(await screen.findByRole("button", { name: /^promote$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve /i })).not.toBeInTheDocument();
  });

  it("confirms every action with a toast", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: "success" });
  });

  it("offers a way to see what changed, on the actions that change something", async () => {
    const user = userEvent.setup();
    const onViewSection = vi.fn();
    render(<ProposalsPanel onViewSection={onViewSection} sectionTitles={{ knowledge: "Knowledge" }} />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const { action } = toast.mock.calls[0][0];
    expect(action).toBeTruthy();
    // A link nobody has time to click is not a link. The default is 5s.
    expect(toast.mock.calls[0][0].duration).toBeGreaterThan(5000);
    render(action);
    await user.click(screen.getByRole("button", { name: /view in knowledge/i }));
    expect(onViewSection).toHaveBeenCalledWith("knowledge");
  });

  describe("promotion asks where it should go", () => {
    async function openPromoteDialog(user, props = {}) {
      render(<ProposalsPanel packs={PACKS} sectionTitles={{ lifestyle: "Lifestyle" }} {...props} />);
      await user.click(screen.getByRole("tab", { name: /observations/i }));
      await user.click(await screen.findByRole("button", { name: /^promote$/i }));
      return screen.findByRole("dialog");
    }

    it("only offers entities that a single line of text can actually fill", () => {
      const targets = promotionTargets(PACKS[0]).map((t) => t.entity);
      expect(targets).toEqual(["hobby", "value"]);
      // hobby_specific needs an owning hobby as well, so a bare note cannot
      // make one -- offering it would produce a proposal that cannot execute.
      expect(targets).not.toContain("hobby_specific");
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
      await pick(user, dialog, /^type$/i, "value");
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

    it("cancelling files nothing", async () => {
      const user = userEvent.setup();
      const dialog = await openPromoteDialog(user);
      await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
      expect(api.promoteProposal).not.toHaveBeenCalled();
    });
  });

  it("tells the app which section to refetch, so the link does not land on stale data", async () => {
    const user = userEvent.setup();
    const onSectionChanged = vi.fn();
    render(<ProposalsPanel onSectionChanged={onSectionChanged} />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(onSectionChanged).toHaveBeenCalledWith("knowledge"));
  });

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

  it("says so when an action fails, and keeps the row", async () => {
    const user = userEvent.setup();
    api.approveProposal.mockRejectedValueOnce(new Error("boom"));
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve /i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    // The row is still there to try again. Asserted on the collapsed line,
    // since the rationale it used to check now sits behind the chevron.
    expect(screen.getByRole("button", { name: /^approve /i })).toBeInTheDocument();
  });

  it("says the queue is empty rather than showing nothing", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  describe("an empty queue says which fix applies", () => {
    beforeEach(() => { api.listProposals.mockResolvedValue([]); });

    it("points at the connect flow when nothing is connected", async () => {
      api.listConnectedApps.mockResolvedValue([]);
      render(<ProposalsPanel />);
      expect(await screen.findByText(/nothing is connected yet/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect an app/i })).toBeInTheDocument();
    });

    it("names the app that can read but not propose", async () => {
      api.listConnectedApps.mockResolvedValue([
        { id: "g1", clientId: "c1", clientName: "Claude Desktop", scopes: ["persona:read"] },
      ]);
      render(<ProposalsPanel />);
      expect(await screen.findByText(
        /Claude Desktop can read your persona but not suggest changes/i)).toBeInTheDocument();
    });

    it("does not name one app when several are connected and none can propose", async () => {
      api.listConnectedApps.mockResolvedValue([
        { id: "g1", clientId: "c1", clientName: "Claude Desktop", scopes: ["persona:read"] },
        { id: "g2", clientId: "c2", clientName: "Cursor", scopes: ["persona:read"] },
      ]);
      render(<ProposalsPanel />);
      expect(await screen.findByText(
        /None of your connections can suggest changes/i)).toBeInTheDocument();
    });

    it("says nothing extra when something can propose", async () => {
      api.listConnectedApps.mockResolvedValue([
        { id: "g1", clientId: "c1", clientName: "Cursor",
          scopes: ["persona:read", "persona:propose"] },
      ]);
      render(<ProposalsPanel />);
      expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
      await waitFor(() => expect(api.listConnectedApps).toHaveBeenCalled());
      expect(screen.queryByText(/not suggest changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/nothing is connected/i)).not.toBeInTheDocument();
    });

    it("counts a used token as connected, not just OAuth grants", async () => {
      // The P0 from the 2026-09-24 critique: a token-only user was told
      // "Nothing is connected yet" by the one screen that waits on a client.
      api.listConnectedApps.mockResolvedValue([]);
      api.listTokens.mockResolvedValue([
        { id: "t1", label: "Claude Code", last_used_at: "2026-09-22T10:00:00Z",
          scopes: ["persona:read", "persona:propose"] },
      ]);
      render(<ProposalsPanel />);
      await waitFor(() => expect(api.listTokens).toHaveBeenCalled());
      expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
      expect(screen.queryByText(/nothing is connected/i)).not.toBeInTheDocument();
    });

    it("says a token is waiting for its first call", async () => {
      api.listConnectedApps.mockResolvedValue([]);
      api.listTokens.mockResolvedValue([
        { id: "t1", label: "Cursor", last_used_at: null, scopes: ["persona:read"] },
      ]);
      render(<ProposalsPanel />);
      expect(await screen.findByText(/Cursor is set up but hasn.t been used yet/i))
        .toBeInTheDocument();
    });

    it("sends Connect an app to the connect flow", async () => {
      api.listConnectedApps.mockResolvedValue([]);
      api.listTokens.mockResolvedValue([]);
      const onConnect = vi.fn();
      render(<ProposalsPanel onConnect={onConnect} />);
      fireEvent.click(await screen.findByRole("button", { name: /connect an app/i }));
      expect(onConnect).toHaveBeenCalled();
    });

    it("opens the tab that manages the read-only connection", async () => {
      api.listTokens.mockResolvedValue([]);
      api.listConnectedApps.mockResolvedValue([
        { id: "g1", clientId: "c1", clientName: "Claude Desktop", scopes: ["persona:read"] },
      ]);
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
      expect(api.listConnectedApps).not.toHaveBeenCalled();
    });
  });
});
