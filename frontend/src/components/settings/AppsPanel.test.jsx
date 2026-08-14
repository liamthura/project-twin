import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listConnectedApps: vi.fn(async () => [
      { id: "g1", clientName: "Claude Desktop", scopes: ["persona:read", "persona:propose"] },
    ]),
    revokeConnectedApp: vi.fn(async () => {}),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { listConnectedApps, revokeConnectedApp } from "@/lib/api.js";
import { AppsPanel } from "./AppsPanel";

beforeEach(() => vi.clearAllMocks());

describe("AppsPanel", () => {
  it("fetches nothing while its tab is closed", () => {
    render(<AppsPanel isOpen={false} />);
    expect(listConnectedApps).not.toHaveBeenCalled();
  });

  it("lists the grants once opened", async () => {
    render(<AppsPanel isOpen />);
    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
  });

  it("shows the failure rather than an empty list", async () => {
    listConnectedApps.mockRejectedValueOnce(new Error("Service unavailable"));
    render(<AppsPanel isOpen />);
    expect(await screen.findByText(/Service unavailable/)).toBeInTheDocument();
  });

  it("revokes, then reloads", async () => {
    render(<AppsPanel isOpen />);
    await screen.findByText("Claude Desktop");

    fireEvent.click(screen.getByRole("button", { name: /revoke access/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke access$/i }));

    await waitFor(() => expect(revokeConnectedApp).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(listConnectedApps).toHaveBeenCalledTimes(2));
  });

  it("rethrows a failed revoke, so the confirm row stays open", async () => {
    revokeConnectedApp.mockRejectedValueOnce(new Error("nope"));
    render(<AppsPanel isOpen />);
    await screen.findByText("Claude Desktop");

    fireEvent.click(screen.getByRole("button", { name: /revoke access/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke access$/i }));

    // ConnectedApps keeps its row in confirm mode by NOT clearing state when
    // onRevoke rejects. Swallowing the error here would collapse the row as
    // though the revoke had worked.
    await waitFor(() => expect(revokeConnectedApp).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
