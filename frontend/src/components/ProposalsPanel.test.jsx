import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalsPanel from "./ProposalsPanel";

vi.mock("@/lib/api", () => ({
  listProposals: vi.fn(),
  approveProposal: vi.fn(() => Promise.resolve({ status: "approved", section: "knowledge" })),
  rejectProposal: vi.fn(() => Promise.resolve({ status: "rejected", section: null })),
  promoteProposal: vi.fn(() => Promise.resolve({ status: "promoted", section: "lifestyle" })),
}));

const toast = vi.fn();
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
  it("shows the rationale and the evidence, not just the change", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText(/Runs the on-call dashboards unaided/)).toBeInTheDocument();
    expect(screen.getByText(/I rebuilt the whole alerting setup myself/)).toBeInTheDocument();
  });

  it("renders the change as fields, never as raw JSON", async () => {
    render(<ProposalsPanel />);
    // The whole point of this surface is that a person reads it and decides.
    expect(await screen.findByText("Update")).toBeInTheDocument();
    expect(screen.getByText("domain")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Datadog")).toBeInTheDocument();
    expect(screen.getByText("level")).toBeInTheDocument();
    expect(screen.getByText("advanced")).toBeInTheDocument();
    expect(screen.queryByText(/[{}"]/)).not.toBeInTheDocument();
  });

  it("reads snake_case keys as words", async () => {
    api.listProposals.mockImplementation((kind) =>
      Promise.resolve(kind === "entity"
        ? [{ ...ENTITY, entity: "work_experience", data: { company: "Acme", start_date: "2026-01" } }]
        : []),
    );
    render(<ProposalsPanel />);
    expect(await screen.findByText("work experience")).toBeInTheDocument();
    expect(screen.getByText("start date")).toBeInTheDocument();
  });

  it("names the tool that proposed it", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText("Cursor")).toBeInTheDocument();
  });

  it("shows how many tools raised the same thing", async () => {
    render(<ProposalsPanel />);
    expect(await screen.findByText(/seen 2×/)).toBeInTheDocument();
  });

  it("approves and drops the row", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1", undefined));
    await waitFor(() =>
      expect(screen.queryByText(/Runs the on-call dashboards/)).not.toBeInTheDocument(),
    );
  });

  it("rejects without writing anything", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith("p1"));
    expect(api.approveProposal).not.toHaveBeenCalled();
  });

  it("offers promote and delete on observations, never approve", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(screen.getByRole("button", { name: /observations/i }));
    expect(await screen.findByRole("button", { name: /^promote$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("confirms every action with a toast", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: "success" });
  });

  it("offers a way to see what changed, on the actions that change something", async () => {
    const user = userEvent.setup();
    const onViewSection = vi.fn();
    render(<ProposalsPanel onViewSection={onViewSection} sectionTitles={{ knowledge: "Knowledge" }} />);
    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const { action } = toast.mock.calls[0][0];
    expect(action).toBeTruthy();
    // A link nobody has time to click is not a link. The default is 5s.
    expect(toast.mock.calls[0][0].duration).toBeGreaterThan(5000);
    render(action);
    await user.click(screen.getByRole("button", { name: /view in knowledge/i }));
    expect(onViewSection).toHaveBeenCalledWith("knowledge");
  });

  it("promoting links to the section the note became part of", async () => {
    const user = userEvent.setup();
    const onViewSection = vi.fn();
    render(<ProposalsPanel onViewSection={onViewSection} sectionTitles={{ lifestyle: "Lifestyle" }} />);
    await user.click(screen.getByRole("button", { name: /observations/i }));
    await user.click(await screen.findByRole("button", { name: /^promote$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const { action } = toast.mock.calls[0][0];
    render(action);
    await user.click(screen.getByRole("button", { name: /view in lifestyle/i }));
    expect(onViewSection).toHaveBeenCalledWith("lifestyle");
  });

  it("gives rejecting a toast but no link, because nothing changed", async () => {
    const user = userEvent.setup();
    render(<ProposalsPanel onViewSection={vi.fn()} sectionTitles={{}} />);
    await user.click(await screen.findByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].action).toBeUndefined();
  });

  it("says so when an action fails, and keeps the row", async () => {
    const user = userEvent.setup();
    api.approveProposal.mockRejectedValueOnce(new Error("boom"));
    render(<ProposalsPanel />);
    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    expect(screen.getByText(/Runs the on-call dashboards/)).toBeInTheDocument();
  });

  it("says the queue is empty rather than showing nothing", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });
});
