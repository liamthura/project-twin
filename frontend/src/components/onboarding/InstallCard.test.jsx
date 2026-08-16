import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText(/add custom connector/i)).toBeInTheDocument();
    expect(screen.getByText(TEST_URL)).toBeInTheDocument();
  });

  it("offers the address for copying", async () => {
    const user = userEvent.setup();
    render(<InstallCard client={client("raycast")} url={TEST_URL} />);

    await user.click(screen.getByRole("button", { name: /copy server address/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(TEST_URL);
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
