import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getInstanceMock = vi.hoisted(() => vi.fn());
const createTokenMock = vi.hoisted(() => vi.fn());
const startTourMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getInstance: getInstanceMock,
  createToken: createTokenMock,
  mcpUrl: () => "https://example.test/mcp",
}));
vi.mock("@/lib/guide.js", () => ({ startTour: startTourMock }));

const { StepConnect } = await import("./StepConnect");
const { INSTALLABLE_CLIENTS } = await import("@/lib/clients.js");
const { OTHER_CLIENT } = await import("./StepAssistant");
const cursor = INSTALLABLE_CLIENTS.find((c) => c.id === "cursor");

const report = (state, extra = {}) => ({
  connection: { state, name: null, can_propose: true, ...extra },
  assistant: {},
  pending: { total: 0 },
});
const renderStep = (props = {}) =>
  render(<StepConnect client={cursor} report={null} onBack={vi.fn()} onContinue={vi.fn()} {...props} />);

beforeEach(() => {
  getInstanceMock.mockReset().mockResolvedValue({ mcp_oauth: true });
  createTokenMock.mockReset().mockResolvedValue({ token: "mg_secret_value" });
  startTourMock.mockClear();
});

describe("StepConnect", () => {
  it("names the assistant you chose and waits for it", async () => {
    renderStep();
    expect(await screen.findByRole("heading", { name: "Connect Cursor" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Cursor to connect…");
    expect(screen.getByRole("button", { name: "Continue without waiting" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
  });

  it("says so once it is connected, by the name it connected with", async () => {
    const onContinue = vi.fn();
    renderStep({ report: report("connected", { name: "Cursor (work)" }), onContinue });
    expect(await screen.findByRole("status")).toHaveTextContent("Cursor (work) is connected.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("warns when the connection can only read", async () => {
    renderStep({ report: report("connected", { can_propose: false }) });
    expect(await screen.findByRole("status")).toHaveTextContent(/can only read/);
  });

  it("keeps the assistant's own steps on screen when a token already exists", async () => {
    // The old Connect hid every sign-in route once any token existed.
    renderStep({ report: report("waiting", { name: "my assistant", kind: "token" }) });
    expect(await screen.findByRole("link", { name: /add to cursor/i })).toBeInTheDocument();
  });

  it("shows the token route on an instance without sign-in", async () => {
    getInstanceMock.mockResolvedValue({ mcp_oauth: false });
    renderStep();
    expect(await screen.findByRole("button", { name: "Create a token" })).toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it("Back goes back to the choice", async () => {
    const onBack = vi.fn();
    renderStep({ onBack });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("Something else offers the prompt, then a token that keeps its steps", async () => {
    const user = userEvent.setup();
    renderStep({ client: OTHER_CLIENT });
    expect(await screen.findByRole("heading", { name: "Connect your assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy prompt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "My assistant needs a token" }));
    await user.click(screen.getByRole("button", { name: "Create a token" }));
    expect(await screen.findByText("mg_secret_value")).toBeInTheDocument();
    expect(screen.getByText("Copy the token now")).toBeInTheDocument();
    expect(screen.getByText(/add an MCP server with the address below/)).toBeInTheDocument();
    expect(createTokenMock).toHaveBeenCalledWith("my assistant", ["persona:propose"]);
    expect(startTourMock).toHaveBeenCalledWith("guide:token", expect.any(Array));
    // No status until the token has gone where it is needed. (The address and
    // token are <output>s, which are role=status too, so this asks by text.)
    expect(screen.queryByText("Waiting for your assistant to connect…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(screen.getByText("Waiting for your assistant to connect…")).toBeInTheDocument();
  });
});
