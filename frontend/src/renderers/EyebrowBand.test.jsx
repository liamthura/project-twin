import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EyebrowBand } from "./EyebrowBand";

describe("EyebrowBand", () => {
  it("names the group as a level-3 heading", () => {
    // A band labels the cards beneath it, so it is a heading in the document
    // outline -- not decorative text. Level 3 keeps the tree the depth rule
    // already implies: page title h2, top-level node h3.
    render(<EyebrowBand title="Code Style" />);
    expect(screen.getByRole("heading", { name: "Code Style", level: 3 })).toBeInTheDocument();
  });

  it("sets the label in mono, uppercase and tracked, which is what makes it an eyebrow", () => {
    // caption-2: 13px Geist Mono, +0.06em, uppercase, muted. Mono is reserved
    // for strings that really are machine output -- the build hash, and these
    // labels -- so this is the one place in the editor it appears.
    render(<EyebrowBand title="Code Style" />);
    const label = screen.getByRole("heading", { name: "Code Style" });
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("tracking-[0.06em]");
    expect(label.className).toContain("text-[13px]");
    expect(label.className).toContain("text-muted-foreground");
  });

  it("rules out to the end of the row, decoratively", () => {
    // The rule is what makes the label read as a band rather than a stray
    // heading. It is aria-hidden and NOT a separator role: it does not divide
    // anything, it belongs to the label.
    render(<EyebrowBand title="Code Style" />);
    const rule = document.querySelector("[data-eyebrow-rule]");
    expect(rule).not.toBeNull();
    expect(rule).toHaveAttribute("aria-hidden", "true");
    expect(rule.className).toContain("flex-1");
    expect(rule.className).toContain("h-px");
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  });

  it("keeps the group's info button, in the band's own row", () => {
    // Groups declare `info` in the manifests; the restructure must not be the
    // reason one loses its explainer.
    render(<EyebrowBand title="Code Style" info={{ overview: "How you write code" }} />);
    const heading = screen.getByRole("heading", { name: "Code Style" });
    const button = screen.getByRole("button", { name: "About Code Style" });
    expect(heading.parentElement).toBe(button.parentElement);
  });

  it("renders no button for a group that declares no info", () => {
    render(<EyebrowBand title="Communication" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
