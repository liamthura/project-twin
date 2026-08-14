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

  it("defaults to replace, and says what it does", () => {
    render(<DataPanel />);
    expect(screen.getByText(/Replace overwrites/i)).toBeInTheDocument();
  });

  it("describes merge once merge is chosen", () => {
    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(screen.getByText(/Merge combines/i)).toBeInTheDocument();
  });
});
