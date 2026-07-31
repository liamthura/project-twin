import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConnectedApps from "./ConnectedApps.jsx";

const GRANTS = [
  {
    id: "consent-1",
    clientName: "Claude Desktop",
    scopes: ["persona:read", "persona:propose"],
    lastUsedAt: "2026-07-30T10:00:00Z",
  },
];

describe("ConnectedApps", () => {
  it("lists each app with what it may do", async () => {
    render(<ConnectedApps grants={GRANTS} onRevoke={vi.fn()} />);
    expect(await screen.findByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/Suggest changes/i)).toBeInTheDocument();
  });

  it("does not offer a scope the grant never included", () => {
    render(<ConnectedApps grants={GRANTS} onRevoke={vi.fn()} />);
    expect(screen.queryByText(/Change your persona directly/i)).toBeNull();
  });

  it("says access ends within ten minutes rather than implying it is instant", async () => {
    render(<ConnectedApps grants={GRANTS} onRevoke={vi.fn()} />);
    expect(await screen.findByText(/10 minutes/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is connected", () => {
    render(<ConnectedApps grants={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText(/No applications/i)).toBeInTheDocument();
  });
});
