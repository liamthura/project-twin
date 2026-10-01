import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INSTALLABLE_CLIENTS } from "@/lib/clients.js";

import { ClientPicker } from "./ClientPicker";
import { OTHER_CLIENT } from "./StepAssistant";

const renderPicker = (onChoose = vi.fn()) =>
  render(<ClientPicker clients={[...INSTALLABLE_CLIENTS, OTHER_CLIENT]} onChoose={onChoose} />);

describe("ClientPicker", () => {
  it("lists each assistant with the effort it takes", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "Cursor, one click" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex, one command" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude, a few steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Something else, paste a prompt, or use a token" })).toBeInTheDocument();
  });

  it("reports the choice, and opens nothing in place", async () => {
    const onChoose = vi.fn();
    renderPicker(onChoose);
    await userEvent.setup().click(screen.getByRole("button", { name: "Claude, a few steps" }));
    expect(onChoose).toHaveBeenCalledWith("claude-desktop");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("draws an icon, not a letter, for an assistant with no logo", () => {
    const { container } = renderPicker();
    // Cursor, Codex and Hermes have no mark file; each gets an svg, not "C".
    expect(container.querySelectorAll("img").length).toBe(
      INSTALLABLE_CLIENTS.filter((c) => c.mark).length,
    );
    expect(screen.queryByText(/^[CH]$/)).not.toBeInTheDocument();
  });
});
