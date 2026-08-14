import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getConfig: vi.fn(() => null),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    getApiBase: vi.fn(() => "/api"),
    testConnection: vi.fn(async () => ({})),
    whoami: vi.fn(async () => ({ username: "Liam" })),
  };
});

vi.mock("@/lib/session.js", () => ({ signOut: vi.fn(async () => {}) }));

import {
  getConfig,
  saveConfig,
  clearConfig,
  getApiBase,
  testConnection,
} from "@/lib/api.js";
import { signOut } from "@/lib/session.js";
import { ServerPanel } from "./ServerPanel";

const open = (props = {}) =>
  render(
    <ServerPanel
      isSignedIn
      onConnectionChange={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockReturnValue(null);
  getApiBase.mockReturnValue("/api");
});

describe("with no saved config", () => {
  it("leads with the instance that served the page, not with Cloud", () => {
    // The bug this replaces: the old panel selected Cloud whenever there was no
    // config, while getApiBase() returned /api. It then printed
    // "Current API: /api" two panels below, contradicting its own chip.
    open();
    expect(screen.getByText(/This instance/i)).toBeInTheDocument();
    expect(screen.getByText("/api")).toBeInTheDocument();
    expect(screen.queryByText(/MyGist Cloud/i)).not.toBeInTheDocument();
  });

  it("names the self-hosted origin, rather than the cloud URL", () => {
    // The case that made this a bug rather than a cosmetic slip.
    getApiBase.mockReturnValue("https://gist.example.test/api");
    open();
    expect(screen.getByText("https://gist.example.test/api")).toBeInTheDocument();
  });

  it("keeps the custom-server fields out of the way until asked for", () => {
    open();
    expect(screen.queryByLabelText(/Server URL/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.getByLabelText(/Server URL/i)).toBeInTheDocument();
  });
});

describe("with a saved custom server", () => {
  beforeEach(() => {
    getConfig.mockReturnValue({ serverUrl: "https://example.test/api" });
    getApiBase.mockReturnValue("https://example.test/api");
  });

  it("opens in the custom state, with the URL filled", () => {
    open();
    expect(screen.getByLabelText(/Server URL/i)).toHaveValue("https://example.test/api");
  });

  it("offers a way back, and says that it signs you out", () => {
    // handleReset has always called signOut. "Reset to Default" never said so.
    open();
    expect(screen.getByText(/signs you out/i)).toBeInTheDocument();
  });

  it("clears the config and signs out when reset", async () => {
    const onConnectionChange = vi.fn();
    open({ onConnectionChange });

    fireEvent.click(screen.getByRole("button", { name: /reset to this instance/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(clearConfig).toHaveBeenCalled();
    expect(onConnectionChange).toHaveBeenCalled();
  });

  it("returns to the default state after a reset", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /reset to this instance/i }));
    expect(await screen.findByText(/This instance/i)).toBeInTheDocument();
  });
});

describe("the cloud preset", () => {
  it("fills the field, for a UI running away from its server", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.click(screen.getByRole("button", { name: /Use MyGist Cloud/i }));
    expect(screen.getByLabelText(/Server URL/i)).toHaveValue(
      "https://mygist.thuradev.qzz.io/api",
    );
  });
});

describe("testing and saving", () => {
  it("reports who the server says you are", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://example.test/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Connected as Liam/)).toBeInTheDocument();
  });

  it("refuses to test an empty URL rather than testing the wrong one", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Server URL is required/i)).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("reports a server that cannot be reached", async () => {
    testConnection.mockRejectedValueOnce(new Error("Failed to fetch"));
    open();
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://nope.test/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it("saves the URL and closes", () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    fireEvent.change(screen.getByLabelText(/Server URL/i), {
      target: { value: "https://example.test/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(saveConfig).toHaveBeenCalledWith({
      serverUrl: "https://example.test/api",
      token: "",
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the manual token field", () => {
  it("is offered when there is no credential", () => {
    open({ isSignedIn: false });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.getByLabelText(/API token/i)).toBeInTheDocument();
  });

  it("is not offered when there is one", () => {
    open({ isSignedIn: true });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.queryByLabelText(/API token/i)).not.toBeInTheDocument();
  });

  it("hides the token by default and reveals it on request", () => {
    open({ isSignedIn: false });
    fireEvent.click(screen.getByRole("button", { name: /custom server/i }));
    expect(screen.getByLabelText(/API token/i)).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: /^show$/i }));
    expect(screen.getByLabelText(/API token/i)).toHaveAttribute("type", "text");
  });
});
