import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("recommends signing in, and shows the address without a key", async () => {
    renderStep();

    expect(await screen.findByText(/recommended/i)).toBeInTheDocument();
    expect(screen.getByText("https://example.test/mcp")).toBeInTheDocument();
    // The key path is still reachable, but it is not what the screen leads with.
    expect(screen.queryByRole("button", { name: /create a key/i })).not.toBeInTheDocument();
  });

  it("spells the setup out as numbered steps", async () => {
    renderStep();
    await screen.findByText(/recommended/i);

    expect(screen.getByText(/add a custom mcp connector/i)).toBeInTheDocument();
    expect(screen.getByText(/asks you to sign in/i)).toBeInTheDocument();
  });

  it("keeps the key path for a client that cannot sign in", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /can't sign in/i }));
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
  });

  it("stops recommending a connection once one exists", async () => {
    // Instructions for a job already done are noise.
    listConnectedAppsMock.mockResolvedValue([
      { id: "g1", clientId: "c1", clientName: "Claude", scopes: ["persona:propose"] },
    ]);
    renderStep();

    expect(await screen.findByText(/connected · Claude/i)).toBeInTheDocument();
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
  });
});

describe("StepConnect, where clients cannot sign in", () => {
  it("leads with the key and says why", async () => {
    renderStep();

    expect(
      await screen.findByText(/does not offer sign-in for clients/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a key/i })).toBeInTheDocument();
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
  });

  it("recommends nothing when the instance cannot be reached", async () => {
    // getInstance falls back to mcp_oauth: false. Recommending sign-in on an
    // instance that mounts no discovery routes sends someone into a 404.
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: false });
    renderStep();

    await screen.findByRole("button", { name: /create a key/i });
    expect(screen.queryByText(/recommended/i)).not.toBeInTheDocument();
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

  it("reports a failed key rather than looking like nothing happened", async () => {
    createTokenMock.mockRejectedValue(new Error("Token limit reached"));
    const user = userEvent.setup();
    renderStep();

    await user.click(await screen.findByRole("button", { name: /create a key/i }));
    expect(await screen.findByText(/token limit reached/i)).toBeInTheDocument();
  });
});

describe("StepConnect, the documentation link", () => {
  it("points at the OAuth section when that is what it recommended", async () => {
    getInstanceMock.mockResolvedValue({ invite_only: false, mcp_oauth: true });
    renderStep();

    const link = await screen.findByRole("link", { name: /setting this up in claude/i });
    expect(link).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/use/clients/#connecting-over-oauth`,
    );
  });

  it("points at the token section on the key path", async () => {
    renderStep();
    const link = await screen.findByRole("link", { name: /where the key goes/i });
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
    expect(screen.getByRole("link", { name: /where the key goes/i })).toBeInTheDocument();
  });

  it("opens in a new tab, because a shown-once key is lost by navigating away", async () => {
    renderStep();
    const link = await screen.findByRole("link", { name: /where the key goes/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});
