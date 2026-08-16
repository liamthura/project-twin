import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listTokensMock = vi.hoisted(() => vi.fn());
const listConnectedAppsMock = vi.hoisted(() => vi.fn());
const createTokenMock = vi.hoisted(() => vi.fn());
const getInstanceMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listTokens: listTokensMock,
    listConnectedApps: listConnectedAppsMock,
    createToken: createTokenMock,
    getInstance: getInstanceMock,
    mcpUrl: () => "https://example.test/mcp",
  };
});

const { StepConnect } = await import("./StepConnect");
const { AUTOFILL_PROMPT } = await import("./autofillPrompt");

beforeEach(() => {
  listTokensMock.mockReset().mockResolvedValue([]);
  listConnectedAppsMock.mockReset().mockResolvedValue([]);
  // Default to the instance the preview actually is: no OAuth. Each test that
  // cares about the other case says so.
  getInstanceMock.mockReset().mockResolvedValue({ invite_only: false, mcp_oauth: false });
  createTokenMock.mockReset().mockResolvedValue({
    id: "t1",
    label: "my assistant",
    token: "mg_secret_value",
  });
});

const renderStep = (props = {}) =>
  render(
    <StepConnect onDelegate={vi.fn()} onFillManually={vi.fn()} {...props} />,
  );

describe("StepConnect, where clients can sign in", () => {
  beforeEach(() => {
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: true });
  });

  it("offers a client to pick rather than generic instructions", async () => {
    renderStep();

    expect(await screen.findByRole("button", { name: /claude code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cursor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /raycast/i })).toBeInTheDocument();
    // The key path is reachable, but it is not what the screen leads with.
    expect(screen.queryByRole("button", { name: /create a key/i })).not.toBeInTheDocument();
  });

  it("shows the command once a command client is picked", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /claude code/i }));
    expect(
      screen.getByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).toBeInTheDocument();
  });

  it("shows the deeplink once Cursor is picked", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /cursor/i }));
    expect(screen.getByRole("link", { name: /add to cursor/i })).toBeInTheDocument();
  });

  it("offers a prompt for a client that is not on the list", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /isn't listed/i }));
    await user.click(screen.getByRole("button", { name: /copy prompt for my client/i }));
    await expect(navigator.clipboard.readText()).resolves.toContain(
      "https://example.test/mcp",
    );
  });

  it("keeps the key path for a client that cannot sign in", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /can't sign in/i }));
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
  });

  it("resets the fallback copy button to its label after the copied state times out", async () => {
    // Same shape as InstallCard.test.jsx's own version of this: fireEvent,
    // not userEvent, once fake timers are in, because userEvent awaits
    // promises that vitest's fake clock also owns, so the click never
    // settles before the assertion.
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /isn't listed/i }));
    const button = await screen.findByRole("button", {
      name: /copy prompt for my client/i,
    });

    vi.useFakeTimers();
    try {
      fireEvent.click(button);
      expect(screen.getByText("Copied")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByText("Copy prompt for my client")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles the fallback open and closed, and aria-expanded follows it both ways", async () => {
    // The old version only ever revealed the panel once clicked, with no way
    // back and no aria-expanded at all. Clicking the trigger a SECOND time is
    // the case that version would still have passed every other test on.
    const user = userEvent.setup();
    renderStep();

    const trigger = await screen.findByRole("button", { name: /isn't listed/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /copy prompt for my client/i }),
    ).toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /copy prompt for my client/i }),
    ).not.toBeInTheDocument();
  });

  it("closes the fallback once a client is picked from the list", async () => {
    // ClientPicker already keeps its own rows to one open at a time; the
    // fallback has to honour that discipline too, or picking Claude Code
    // leaves the fallback's own copyable prompt open beside it.
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /isn't listed/i }));
    expect(
      screen.getByRole("button", { name: /copy prompt for my client/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /claude code/i }));
    expect(
      screen.queryByRole("button", { name: /copy prompt for my client/i }),
    ).not.toBeInTheDocument();
  });

  it("closes the picked client's card once the fallback is opened", async () => {
    // The same rule, the other way round: opening the fallback while a
    // client's install card is open would put two copyable routes on screen.
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /claude code/i }));
    expect(
      screen.getByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /isn't listed/i }));
    expect(
      screen.queryByText("claude mcp add --transport http mygist https://example.test/mcp"),
    ).not.toBeInTheDocument();
  });

  it("closes the picked client's card once the key path is opened", async () => {
    // The picker and the fallback prompt already clear each other. Without the
    // same rule here, picking Raycast then asking for a key leaves Raycast's
    // steps and the key's steps on screen together -- two contradictory
    // procedures for the same client.
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /raycast/i }));
    expect(screen.getByText(/open raycast settings/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /can't sign in/i }));
    expect(screen.queryByText(/open raycast settings/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
  });

  it("stops offering a connection once one exists", async () => {
    // Instructions for a job already done are noise.
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderStep();

    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
  });
});

describe("StepConnect, where clients cannot sign in", () => {
  it("leads with the key and says why", async () => {
    renderStep();

    expect(
      await screen.findByText(/does not offer sign-in for clients/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
    // No picker at all: every card on it tells someone to sign in, and this
    // instance mounts no discovery routes for them to sign in against.
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
  });

  it("shows no picker when the instance cannot be reached", async () => {
    // getInstance falls back to mcp_oauth: false. Recommending sign-in on an
    // instance that mounts no discovery routes sends someone into a 404.
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: false });
    renderStep();

    await screen.findByRole("button", { name: /create a key/i });
    expect(screen.queryByRole("button", { name: /claude code/i })).not.toBeInTheDocument();
    // installPrompt() asserts OAuth unconditionally, which is only true inside
    // the mcp_oauth-gated block above. This pins the fallback itself to that
    // gate, not just the picker: moving the escape hatch out from under it
    // would still pass every other assertion here while shipping that false
    // claim to a self-hosted instance.
    expect(screen.queryByRole("button", { name: /isn't listed/i })).not.toBeInTheDocument();
  });
});

describe("StepConnect", () => {
  it("offers to create a key when nothing is connected", async () => {
    renderStep();
    expect(await screen.findByRole("button", { name: /create a key/i })).toBeInTheDocument();
  });

  it("shows the server address and the key once one is created", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("button", { name: /create a key/i }));

    // The address is the gap this step exists to close: the app has never told
    // anyone where to point their client.
    expect(screen.getByText("https://example.test/mcp")).toBeInTheDocument();
    expect(screen.getByText("mg_secret_value")).toBeInTheDocument();
  });

  it("keeps each childless copy button's own name after copying, rather than a shared 'Copied'", async () => {
    // These buttons have no visible text of their own -- aria-label is their
    // entire accessible name. Tracking it to "Copied", the way a button WITH
    // visible text should, would collapse "Copy server address" and "Copy key"
    // into the same indistinguishable label.
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("button", { name: /create a key/i }));

    const copyAddress = screen.getByRole("button", { name: /copy server address/i });
    await user.click(copyAddress);
    expect(copyAddress).toHaveAttribute("aria-label", "Copy server address");

    const copyKey = screen.getByRole("button", { name: /copy key/i });
    await user.click(copyKey);
    expect(copyKey).toHaveAttribute("aria-label", "Copy key");
  });

  it("asks for propose and not write on a first connection", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("button", { name: /create a key/i }));

    expect(createTokenMock).toHaveBeenCalledWith("my assistant", ["persona:propose"]);
  });

  it("offers the prompt as soon as the new key exists", async () => {
    // Read back through user-event's own clipboard: setup() replaces
    // navigator.clipboard with its stub, so a spy installed beforehand is
    // discarded and would report zero calls for a copy that did happen.
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("button", { name: /create a key/i }));

    await user.click(screen.getByRole("button", { name: /copy prompt/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(AUTOFILL_PROMPT);
  });

  it("says why rather than offering a prompt a read-only connection cannot use", async () => {
    // mcp_scopes.py HIDES out-of-scope tools rather than failing them, so the
    // pasted prompt would do nothing at all, with no error anywhere.
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Read only", last_used_at: null, scopes: ["persona:read"] },
    ]);
    renderStep();

    expect(await screen.findByText(/can only read your persona/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy prompt/i })).not.toBeInTheDocument();
  });

  it("names an existing connection rather than asking for another key", async () => {
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderStep();

    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create a key/i })).not.toBeInTheDocument();
  });

  it("takes the delegate branch", async () => {
    const onDelegate = vi.fn();
    const user = userEvent.setup();
    listTokensMock.mockResolvedValue([
      { id: "t1", label: "Claude", last_used_at: null, scopes: ["persona:propose"] },
    ]);
    renderStep({ onDelegate });

    await user.click(
      await screen.findByRole("button", { name: /my assistant will fill it in/i }),
    );
    expect(onDelegate).toHaveBeenCalled();
  });

  it("lets someone type it themselves even with nothing connected", async () => {
    const onFillManually = vi.fn();
    const user = userEvent.setup();
    renderStep({ onFillManually });

    await user.click(await screen.findByRole("button", { name: /fill it in myself/i }));
    expect(onFillManually).toHaveBeenCalled();
  });

  it("keeps an accessible name on the create-a-key button while it is generating", async () => {
    // While generating, the button's only visible content is a bare spinner
    // icon. Without an aria-label for that state the button would have no
    // accessible name at all -- a screen reader user could not tell the
    // button is even there, let alone busy.
    let resolveCreate;
    createTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /create a key/i }));
    expect(
      await screen.findByRole("button", { name: /creating a key/i }),
    ).toBeInTheDocument();

    resolveCreate({ id: "t1", label: "my assistant", token: "mg_secret_value" });
  });

  it("reports a failed key rather than looking like nothing happened", async () => {
    createTokenMock.mockRejectedValue(new Error("Token limit reached"));
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /create a key/i }));
    expect(await screen.findByText(/token limit reached/i)).toBeInTheDocument();
  });
});

describe("StepConnect, the documentation link", () => {
  it("points at the OAuth section when a client can sign in", async () => {
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: true });
    renderStep();

    await screen.findByRole("button", { name: /claude code/i });
    const link = await screen.findByRole("link", { name: /need help connecting/i });
    expect(link).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/use/clients/#connecting-over-oauth`,
    );
  });

  it("points at the token section on the key path", async () => {
    renderStep();
    const link = await screen.findByRole("link", { name: /need help connecting/i });
    expect(link).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/use/clients/#using-a-token-instead`,
    );
  });

  it("keeps the link beside the key once the key is showing", async () => {
    // The block that held the first one is gone by then, and this is the moment
    // someone needs to know where the key goes.
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("button", { name: /create a key/i }));

    expect(screen.getByText("mg_secret_value")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /need help connecting/i })).toBeInTheDocument();
  });

  it("opens in a new tab, because a shown-once key is lost by navigating away", async () => {
    renderStep();
    const link = await screen.findByRole("link", { name: /need help connecting/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("sits on its own line rather than touching the button above it", async () => {
    // The bug this pins: the anchor was inline-flex, so it shared a line with
    // the inline-level Create-a-key button and the two rendered touching --
    // `space-y` on the parent cannot separate inline siblings. Asserting the
    // OLD class is GONE, not merely that the new one is present: a stale
    // inline-flex left alongside would still lose the layout.
    renderStep();
    const link = await screen.findByRole("link", { name: /need help connecting/i });

    expect(link.className).not.toMatch(/\binline-flex\b/);
    expect(link.className).toMatch(/\bflex\b/);
    expect(link.className).toMatch(/\bw-fit\b/);
  });
});
