import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { NumberTicker } from "./number-ticker.jsx";

describe("NumberTicker", () => {
  it("ends on the value it was given", async () => {
    render(<NumberTicker value={7} />);
    // The default findByText wait is 1000ms. This spring's damping (60) is
    // three times its critical value against a stiffness of 100 -- Magic UI's
    // own default -- so it is heavily overdamped and takes real wall-clock
    // time north of a second to round to the target. Given room rather than
    // sped up: changing the spring to satisfy a test changes what users see.
    expect(await screen.findByText("7", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("takes its colour from the theme rather than hardcoding black", () => {
    // The registry version is `text-black dark:text-white`, which ignores every
    // token in globals.css and breaks the moment a surface is not the canvas.
    const { container } = render(<NumberTicker value={3} />);
    expect(container.innerHTML).not.toMatch(/\btext-black\b/);
    expect(container.innerHTML).not.toMatch(/\bdark:text-white\b/);
  });
});
