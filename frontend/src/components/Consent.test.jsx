// The consent screen. See Consent.jsx for why this is the one screen in the
// whole OAuth flow that cannot be gotten wrong: the scope decision made here
// is permanent (MCP has no per-tool step-up), and naming the account is what
// stops a grant from landing on the wrong persona.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Consent from "./Consent.jsx";

const CLIENT = {
  client_name: "Claude Desktop",
  scopes: ["persona:read", "persona:propose", "persona:write"],
};

describe("Consent", () => {
  it("names the client and the account, so the wrong persona cannot be granted by accident", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    expect(screen.getByText(/Claude Desktop/)).toBeInTheDocument();
    expect(screen.getByText(/liamthura/)).toBeInTheDocument();
  });

  it("shows read as always granted rather than as a choice", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    const read = screen.getByLabelText(/Read your persona/i);
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
  });

  it("pre-selects propose and write, and lets them be declined", () => {
    render(<Consent client={CLIENT} username="liamthura" />);
    for (const label of [/Suggest changes/i, /Change your persona directly/i]) {
      const box = screen.getByLabelText(label);
      expect(box).toBeChecked();
      expect(box).not.toBeDisabled();
    }
  });
});
