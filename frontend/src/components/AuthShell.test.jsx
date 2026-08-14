// AuthShell had no tests of its own. It gets two, because the thing being
// changed here is easy to break silently: the mark is inlined SVG, and a wrong
// fill/stroke combination renders an invisible logo rather than an error.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthShell } from "./AuthShell";

describe("AuthShell", () => {
  it("draws the mark once, from the shared component", () => {
    const { container } = render(<AuthShell title="Sign in" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Brand.jsx's Mark takes currentColor so it works on any ground. The copy
    // this replaces hardcoded hsl(var(--primary-foreground)).
    expect(svg.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
  });

  it("shows the title as the page's heading and the description under it", () => {
    render(<AuthShell title="Sign in" description="Sign in to your account." />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
    expect(screen.getByText("Sign in to your account.")).toBeInTheDocument();
  });
});
