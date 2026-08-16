import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { NumberTicker } from "./number-ticker.jsx";

describe("NumberTicker", () => {
  it("ends on the value it was given", async () => {
    render(<NumberTicker value={7} />);
    expect(await screen.findByText("7")).toBeInTheDocument();
  });

  it("does not regress to the registry's hardcoded black-and-white classes", () => {
    // This cannot fail against any runtime branch this component has today --
    // its className is a single literal string. What it catches is someone
    // pasting the upstream registry snippet back over this file, which is
    // `text-black dark:text-white` and ignores every token in globals.css.
    const { container } = render(<NumberTicker value={3} />);
    expect(container.innerHTML).not.toMatch(/\btext-black\b/);
    expect(container.innerHTML).not.toMatch(/\bdark:text-white\b/);
  });
});
