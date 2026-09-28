import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import packs from "@/__fixtures__/packs.json";

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
    getHistoryVersion: vi.fn(async () => ({
      version: { projects: [{ id: "p1", name: "Ledger" }, { id: "p2", name: "Twine" }] },
      current: { projects: [{ id: "p1", name: "Ledger" }] },
    })),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { getHistoryVersion, listHistory, revertHistory } from "@/lib/api.js";
import { HistoryPanel } from "./HistoryPanel";

beforeEach(() => vi.clearAllMocks());

const projects = packs.find((p) => p.key === "projects");

// Restore this opens the preview; the restore happens from the preview.
async function restoreFrom(index) {
  const buttons = await screen.findAllByRole("button", { name: /restore this/i });
  fireEvent.click(buttons[index]);
  const preview = await waitFor(() => {
    const el = document.querySelector("[data-restore-preview]");
    expect(within(el).getByRole("button", { name: /restore this/i })).toBeEnabled();
    return el;
  });
  fireEvent.click(within(preview).getByRole("button", { name: /restore this/i }));
}

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
    await restoreFrom(1);
    await waitFor(() => expect(revertHistory).toHaveBeenCalledWith("projects", 6));
  });

  it("reloads the list after a restore, because the restore is itself a version", async () => {
    render(<HistoryPanel />);
    await screen.findAllByRole("button", { name: /restore this/i });
    expect(listHistory).toHaveBeenCalledTimes(1);
    await restoreFrom(0);
    await waitFor(() => expect(listHistory).toHaveBeenCalledTimes(2));
  });

  it("shows what restoring would change, and restores nothing until asked", async () => {
    render(<HistoryPanel fixedSection="projects" pack={projects} />);
    const [first] = await screen.findAllByRole("button", { name: /restore this/i });
    fireEvent.click(first);
    expect(await screen.findByText("Restoring this would:")).toBeInTheDocument();
    expect(screen.getByText("Twine")).toBeInTheDocument();
    expect(screen.getByText("Bring back")).toBeInTheDocument();
    expect(getHistoryVersion).toHaveBeenCalledWith("projects", 7);
    expect(revertHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Restoring this would:")).not.toBeInTheDocument();
    expect(revertHistory).not.toHaveBeenCalled();
  });

  it("will not restore a version that matches what is there now", async () => {
    getHistoryVersion.mockResolvedValueOnce({
      version: { projects: [{ id: "p1", name: "Ledger" }] },
      current: { projects: [{ id: "p1", name: "Ledger" }] },
    });
    render(<HistoryPanel fixedSection="projects" pack={projects} />);
    const [first] = await screen.findAllByRole("button", { name: /restore this/i });
    fireEvent.click(first);
    expect(await screen.findByText("This version matches what you have now.")).toBeInTheDocument();
    const preview = document.querySelector("[data-restore-preview]");
    expect(within(preview).getByRole("button", { name: /restore this/i })).toBeDisabled();
  });

  it("says nothing is there yet rather than showing an empty list", async () => {
    listHistory.mockResolvedValueOnce([]);
    render(<HistoryPanel />);
    expect(await screen.findByText(/nothing to restore yet/i)).toBeInTheDocument();
  });

  it("scoped to a section, lists only that section and offers no picker", async () => {
    render(<HistoryPanel fixedSection="preferences" sectionTitle="Preferences" />);
    await waitFor(() => expect(listHistory).toHaveBeenCalledWith("preferences"));
    expect(listHistory).not.toHaveBeenCalledWith("projects");
    expect(screen.queryByLabelText("Section")).not.toBeInTheDocument();
  });

  it("tells the page which section it restored, so the editor can refetch it", async () => {
    // Without the refetch the editor keeps the pre-restore data, and the next
    // autosave writes it straight back over the restore.
    const onRestored = vi.fn();
    render(<HistoryPanel fixedSection="preferences" onRestored={onRestored} />);
    await restoreFrom(0);
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith("preferences"));
  });
});
