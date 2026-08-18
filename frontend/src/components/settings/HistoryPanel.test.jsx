import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const settings = {
  packs: [
    { key: "profile", title: "Profile", enabled: true },
    { key: "projects", title: "Projects", enabled: true },
    { key: "media", title: "Media", enabled: false },
  ],
};

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: vi.fn(async () => settings),
    listHistory: vi.fn(async () => [
      {
        id: 7,
        replaced_at: "2026-08-17T09:30:00+00:00",
        written_by: "Claude Code 1.2.3",
        entity_count: 3,
      },
      {
        id: 6,
        replaced_at: "2026-08-16T09:30:00+00:00",
        written_by: null,
        entity_count: 1,
      },
    ]),
    revertHistory: vi.fn(async () => ({ status: "reverted" })),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { listHistory, revertHistory } from "@/lib/api.js";
import { HistoryPanel } from "./HistoryPanel";

beforeEach(() => vi.clearAllMocks());

describe("HistoryPanel", () => {
  it("opens on projects, the section most worth being able to undo", async () => {
    render(<HistoryPanel />);
    await waitFor(() => expect(listHistory).toHaveBeenCalledWith("projects"));
  });

  it("shows each version with its entry count and what caused the write", async () => {
    render(<HistoryPanel />);
    expect(await screen.findByText(/3 entries · replaced by Claude Code 1\.2\.3/))
      .toBeInTheDocument();
    // No client means a web-app write, said plainly rather than left blank or
    // guessed at.
    expect(screen.getByText(/1 entry · replaced from the web app/)).toBeInTheDocument();
  });

  it("restores the version whose button was pressed", async () => {
    render(<HistoryPanel />);
    const buttons = await screen.findAllByRole("button", { name: /restore this/i });
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(revertHistory).toHaveBeenCalledWith("projects", 6));
  });

  it("reloads the list after a restore, because the restore is itself a version", async () => {
    render(<HistoryPanel />);
    const buttons = await screen.findAllByRole("button", { name: /restore this/i });
    expect(listHistory).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(listHistory).toHaveBeenCalledTimes(2));
  });

  it("says nothing is there yet rather than showing an empty list", async () => {
    listHistory.mockResolvedValueOnce([]);
    render(<HistoryPanel />);
    expect(await screen.findByText(/nothing to restore yet/i)).toBeInTheDocument();
  });
});
