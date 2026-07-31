import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalsPanel from "./ProposalsPanel";

vi.mock("@/lib/api", () => ({
  listProposals: vi.fn(),
  approveProposal: vi.fn(() => Promise.resolve({ status: "approved" })),
  rejectProposal: vi.fn(() => Promise.resolve({ status: "rejected" })),
  promoteProposal: vi.fn(() => Promise.resolve({ status: "promoted" })),
}));

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

  it("says the queue is empty rather than showing nothing", async () => {
    api.listProposals.mockResolvedValue([]);
    render(<ProposalsPanel />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });
});
