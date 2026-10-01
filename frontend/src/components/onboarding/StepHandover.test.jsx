import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";

import { AUTOFILL_PROMPT } from "./autofillPrompt";
import { OTHER_CLIENT } from "./StepAssistant";
import { StepHandover } from "./StepHandover";

const codex = INSTALLABLE_CLIENTS.find((c) => c.id === "codex");

const report = ({ read = false, pending = 0, can_propose = true, name = null } = {}) => ({
  connection: { state: "connected", name, can_propose },
  assistant: { read },
  pending: { total: pending },
});
const renderStep = (props = {}) =>
  render(
    <StepHandover
      client={codex}
      report={report()}
      onReview={vi.fn()}
      onTypeMyself={vi.fn()}
      onLater={vi.fn()}
      {...props}
    />,
  );

describe("StepHandover", () => {
  it("asks you to copy the prompt, then to paste it", async () => {
    const user = userEvent.setup();
    renderStep();
    expect(screen.getByRole("heading", { name: "Let Codex fill it in" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(AUTOFILL_PROMPT);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Paste it into Codex. Suggestions appear here as they arrive.",
    );
  });

  it("says when the assistant is reading", () => {
    renderStep({ report: report({ read: true }) });
    expect(screen.getByRole("status")).toHaveTextContent("Codex is reading your persona…");
  });

  it("shows waiting suggestions before anything is copied", async () => {
    const onReview = vi.fn();
    renderStep({ report: report({ pending: 3 }), onReview });
    expect(screen.getByRole("status")).toHaveTextContent("3 suggestions waiting.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Review 3 suggestions" }));
    expect(onReview).toHaveBeenCalled();
  });

  it("explains a connection that can only read, and offers no prompt", () => {
    renderStep({ report: report({ can_propose: false }) });
    expect(screen.getByRole("status")).toHaveTextContent(/can only read your persona/);
    expect(screen.queryByRole("button", { name: "Copy prompt" })).not.toBeInTheDocument();
  });

  it("calls Something else your assistant", () => {
    renderStep({ client: OTHER_CLIENT, report: report({ read: true }) });
    expect(screen.getByRole("heading", { name: "Let your assistant fill it in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your assistant is reading your persona…");
  });

  it("asks the assistant for the stack it can see", () => {
    expect(AUTOFILL_PROMPT).toContain("If you can see the project I'm working in, include my stack and tools from it.");
  });
});
