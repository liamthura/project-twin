import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    exportData: vi.fn(async () => ({ filename: "mygist-backup.zip" })),
    importData: vi.fn(async () => ({ imported_files: ["profile.json"] })),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { exportData, importData } from "@/lib/api.js";
import { DataPanel } from "./DataPanel";

beforeEach(() => vi.clearAllMocks());

describe("DataPanel", () => {
  it("exports on click", async () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportData).toHaveBeenCalled());
  });

  it("imports the chosen file in the chosen mode", async () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    const file = new File(["zip"], "backup.zip", { type: "application/zip" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });

    await waitFor(() => expect(importData).toHaveBeenCalledWith(file, "merge"));
  });

  it("asks before a replace import, naming the file, and cancel imports nothing", async () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^replace$/i }));

    const file = new File(["zip"], "backup.zip", { type: "application/zip" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });

    expect(screen.getByText(/backup\.zip/)).toBeInTheDocument();
    expect(importData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(importData).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });
    // Two buttons read "Replace" now: the mode toggle and the confirm. The
    // confirm is the destructive one without aria-pressed.
    const confirm = screen.getAllByRole("button", { name: /^replace$/i })
      .find((b) => !b.hasAttribute("aria-pressed"));
    fireEvent.click(confirm);
    await waitFor(() => expect(importData).toHaveBeenCalledWith(file, "replace"));
  });

  it("defaults to merge, the mode that cannot lose anything", () => {
    render(<DataPanel />);
    expect(screen.getByText(/Merge adds/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^merge$/i }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("describes replace once replace is chosen", () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^replace$/i }));
    expect(screen.getByText(/Replace overwrites/i)).toBeInTheDocument();
  });
});
