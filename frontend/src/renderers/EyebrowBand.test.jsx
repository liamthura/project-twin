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

  it("is a real heading, one step above the subsection titles, not an eyebrow", () => {
    // It was 13px mono uppercase, smaller than the 16px titles beneath it, so
    // the hierarchy read upside down.
    render(<EyebrowBand title="Code Style" />);
    const label = screen.getByRole("heading", { name: "Code Style" });
    expect(label.className).toContain("text-lg");
    expect(label.className).toContain("font-semibold");
    expect(label.className).not.toContain("font-mono");
    expect(label.className).not.toContain("uppercase");
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
