import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CLIENTS } from "@/lib/clients.js";
import { InstallCard } from "./InstallCard.jsx";

const TEST_URL = "https://example.test/mcp";
const client = (id) => CLIENTS.find((c) => c.id === id);

describe("InstallCard, a command client", () => {
  it("shows the command in full", async () => {
    render(<InstallCard client={client("claude-code")} url={TEST_URL} />);
    expect(
      await screen.findByText(`claude mcp add --transport http mygist ${TEST_URL}`),
    ).toBeInTheDocument();
  });

  it("shows both of Codex's lines", async () => {
    render(<InstallCard client={client("codex")} url={TEST_URL} />);
    expect(await screen.findByText(`codex mcp add mygist --url ${TEST_URL}`)).toBeInTheDocument();
    expect(screen.getByText("codex mcp login mygist")).toBeInTheDocument();
  });

  it("copies every line at once, newline separated", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("codex")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy command/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `codex mcp add mygist --url ${TEST_URL}\ncodex mcp login mygist`,
    );
  });

  it("tracks the visible 'Copied' text in its accessible name, since this button has one", async () => {
    // WCAG 2.5.3 Label in Name: this button has visible text ("Copy command"),
    // so the accessible name must swap with it or a screen reader keeps
    // hearing "Copy command" over a button that now visibly reads "Copied".
    const user = userEvent.setup();
    render(<InstallCard client={client("codex")} url={TEST_URL} />);

    const button = screen.getByRole("button", { name: /copy command/i });
    expect(button).toHaveAttribute("aria-label", "Copy command");
    await user.click(button);
    expect(button).toHaveAttribute("aria-label", "Copied");
  });

  it("resets to its label after the copied state times out", () => {
    // fireEvent, not userEvent: userEvent awaits promises that vitest's fake
    // clock also owns, so the click never settles and the test hangs before
    // reaching an assertion.
    vi.useFakeTimers();
    try {
      render(<InstallCard client={client("codex")} url={TEST_URL} />);
      const button = screen.getByRole("button", { name: /copy command/i });

      fireEvent.click(button);
      expect(screen.getByText("Copied")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByText("Copy command")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("InstallCard, a deeplink client", () => {
  it("offers a labelled button that opens the client", () => {
    render(<InstallCard client={client("cursor")} url={TEST_URL} />);

    const link = screen.getByRole("link", { name: /add to cursor/i });
    expect(link.getAttribute("href")).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/,
    );
  });

  it("still offers the raw link, for a browser that will not hand off the scheme", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("cursor")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy link/i }));
    await expect(navigator.clipboard.readText()).resolves.toMatch(/^cursor:\/\//);
  });
});

describe("InstallCard, a steps client", () => {
  it("numbers the steps and shows the address to paste", () => {
    render(<InstallCard client={client("claude-desktop")} url={TEST_URL} />);

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^1.*Connectors/),
      expect.stringMatching(/^2.*Add custom connector/),
      expect.stringMatching(/^3.*Paste the address/),
      expect.stringMatching(/^4.*Claude opens/),
    ]);
    expect(screen.getByText(TEST_URL)).toBeInTheDocument();
  });

  it("offers the address for copying", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("raycast")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy server address/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(TEST_URL);
  });

  it("keeps its own name after copying rather than a shared 'Copied'", async () => {
    // No visible text on this button -- aria-label is its only content -- so
    // unlike "Copy command" above, it must NOT track the copied state, or every
    // icon-only copy button on the page would read the same thing at once.
    const user = userEvent.setup();
    render(<InstallCard client={client("raycast")} url={TEST_URL} />);

    const button = screen.getByRole("button", { name: /copy server address/i });
    await user.click(button);
    expect(button).toHaveAttribute("aria-label", "Copy server address");
  });
});

describe("InstallCard", () => {
  it("renders nothing for a client with no install path", () => {
    // `unlisted` reaches here only through a bug, and rendering an empty card
    // would look like a card that failed to load.
    const { container } = render(<InstallCard client={client("notion")} url={TEST_URL} />);
    expect(container).toBeEmptyDOMElement();
  });
});
