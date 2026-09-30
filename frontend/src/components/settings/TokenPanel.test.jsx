import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTokens: vi.fn(async () => []),
    createToken: vi.fn(async () => ({ id: "t1", label: "mcp", token: "mg_secret" })),
    revokeToken: vi.fn(async () => {}),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { listTokens, createToken, revokeToken } from "@/lib/api.js";
import { TokenPanel } from "./TokenPanel";

beforeEach(() => {
  vi.clearAllMocks();
  listTokens.mockResolvedValue([]);
});

describe("TokenPanel", () => {
  it("fetches nothing while its tab is closed", () => {
    render(<TokenPanel isOpen={false} />);
    expect(listTokens).not.toHaveBeenCalled();
  });

  it("says so when there are none", async () => {
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/No tokens yet/i)).toBeInTheDocument();
  });

  it("shows the failure rather than an empty list", async () => {
    listTokens.mockRejectedValueOnce(new Error("Service unavailable"));
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/Service unavailable/)).toBeInTheDocument();
  });
});

describe("what a token row says", () => {
  beforeEach(() => {
    listTokens.mockResolvedValue([
      {
        id: "t1",
        label: "Laptop CLI",
        created_at: "2026-08-01T10:00:00Z",
        last_used_at: "2026-08-12T09:00:00Z",
        expires_at: null,
        scopes: ["persona:read", "persona:propose"],
      },
    ]);
  });

  it("states the grant in plain language", async () => {
    // scopes is already returned by db.list_tokens and was thrown away.
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/Read and propose/)).toBeInTheDocument();
  });

  it("gives the dates, and does not set them in mono", async () => {
    // The prototype's change 9 makes this point about Connected apps: a
    // sentence is not a scope string.
    render(<TokenPanel isOpen />);
    const line = await screen.findByText(/Created 1 August 2026/);
    expect(line.textContent).toMatch(/last used 12 August 2026/);
    expect(line.className).not.toMatch(/font-mono/);
  });

  it("says not used yet, for a token no client has used", async () => {
    listTokens.mockResolvedValue([
      {
        id: "t2",
        label: "unused",
        created_at: "2026-08-01T10:00:00Z",
        last_used_at: null,
        expires_at: null,
        scopes: ["persona:read"],
      },
    ]);
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/Created 1 August 2026 · not used yet/)).toBeInTheDocument();
  });

  it("dates a token by the day where you are, not the UTC day", async () => {
    // 02:00 UTC on the 2nd is still the evening of the 1st in New York, where
    // the suite runs. Slicing the ISO string said the 2nd.
    listTokens.mockResolvedValue([
      {
        id: "t4", label: "late", created_at: "2026-08-02T02:00:00Z",
        last_used_at: null, expires_at: null, scopes: ["persona:read"],
      },
    ]);
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/Created 1 August 2026/)).toBeInTheDocument();
  });

  it("names the expiry when there is one", async () => {
    listTokens.mockResolvedValue([
      {
        id: "t3",
        label: "temporary",
        created_at: "2026-08-01T10:00:00Z",
        last_used_at: null,
        expires_at: "2026-09-01T10:00:00Z",
        scopes: ["persona:read"],
      },
    ]);
    render(<TokenPanel isOpen />);
    expect(await screen.findByText(/expires 1 September 2026/)).toBeInTheDocument();
  });

  it("says nothing about expiry for a token that does not expire", async () => {
    render(<TokenPanel isOpen />);
    await screen.findByText("Laptop CLI");
    expect(screen.queryByText(/expires/i)).not.toBeInTheDocument();
  });
});

describe("minting one", () => {
  it("mints read and propose by default, never a direct write", async () => {
    // Nothing lands without the user: direct writes are opted into.
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    await waitFor(() => expect(createToken).toHaveBeenCalled());
    const [label, scopes] = createToken.mock.calls[0];
    // Nothing typed: a name that says so, not the protocol's.
    expect(label).toBe("Unnamed token");
    expect(scopes).toEqual(["persona:read", "persona:propose"]);
  });

  it("adds write only when it is switched on", async () => {
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText(/Change your persona directly/i));
    expect(screen.getByText(/skip your review queue/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    await waitFor(() => expect(createToken).toHaveBeenCalled());
    expect(createToken.mock.calls[0][1]).toEqual(
      ["persona:read", "persona:propose", "persona:write"]);
  });

  it("shows the secret once, and warns that it will not come back", async () => {
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    expect(await screen.findByText("mg_secret")).toBeInTheDocument();
    expect(screen.getByText(/won.t be shown again/i)).toBeInTheDocument();
  });

  it("withdraws write when propose is withdrawn, so the grant stays coherent", async () => {
    render(<TokenPanel isOpen />);
    await waitFor(() => expect(listTokens).toHaveBeenCalled());

    // A token that writes but cannot propose means the same thing as one that
    // writes, so the two are withdrawn together.
    fireEvent.click(screen.getByLabelText(/Suggest changes for your approval/i));
    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

    await waitFor(() => expect(createToken).toHaveBeenCalled());
    expect(createToken.mock.calls[0][1]).toEqual(["persona:read"]);
  });
});

describe("revoking one", () => {
  beforeEach(() => {
    listTokens.mockResolvedValue([
      {
        id: "t1",
        label: "Laptop CLI",
        created_at: "2026-08-01T10:00:00Z",
        last_used_at: null,
        expires_at: null,
        scopes: ["persona:read"],
      },
    ]);
  });

  it("asks first, then revokes and reloads", async () => {
    render(<TokenPanel isOpen />);
    await screen.findByText("Laptop CLI");

    fireEvent.click(screen.getByRole("button", { name: /revoke token/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(listTokens).toHaveBeenCalledTimes(2));
  });

  it("does not revoke on the first click", async () => {
    render(<TokenPanel isOpen />);
    await screen.findByText("Laptop CLI");

    fireEvent.click(screen.getByRole("button", { name: /revoke token/i }));
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
