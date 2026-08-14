/**
 * The date control: what it shows, what it hands back, and the timezone.
 *
 * The round-trip is the part worth testing through the UI rather than only
 * against isoDate.js. The suite pins TZ to America/New_York, so a day picked in
 * the calendar and converted through UTC anywhere along the way comes back as
 * the day before -- and that would be invisible in a unit test of the formatter
 * alone if the component reached for `toISOString` itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DatePicker } from "@/components/DatePicker";

beforeEach(() => vi.clearAllMocks());

// react-day-picker labels each day with the whole date ("Tuesday, December 1st,
// 2026"), not the number, so days are found by accessible name rather than by
// their text. The calendar renders in a portal, so it is found on screen rather
// than in the render container.
const open = async (user, triggerName) => {
  await user.click(screen.getByRole("button", { name: triggerName }));
  return screen.findByRole("grid");
};

describe("what it shows", () => {
  it("reads the stored date the way a person writes one", () => {
    render(<DatePicker value="2026-12-31" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /31 December 2026/ })).toBeInTheDocument();
  });

  it("offers a placeholder when nothing is stored", () => {
    render(<DatePicker value="" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pick a date/i })).toBeInTheDocument();
  });

  it("takes the field's own hint as the placeholder when there is one", () => {
    render(<DatePicker value="" onChange={vi.fn()} placeholder="When by?" />);
    expect(screen.getByRole("button", { name: /when by\?/i })).toBeInTheDocument();
  });

  it("keeps the calendar out of the document until it is asked for", () => {
    render(<DatePicker value="2026-12-31" onChange={vi.fn()} />);
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

describe("clearing", () => {
  it("offers no clear button when there is nothing to clear", () => {
    render(<DatePicker value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
  });

  it("hands back an empty string, not undefined", async () => {
    // The stored shape is a string. Handing back undefined would drop the key
    // from the written object rather than emptying it.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DatePicker value="2026-12-31" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /clear date/i }));

    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("picking a day", () => {
  it("opens on the month of the stored date, not on today", async () => {
    // Otherwise editing a date years out means navigating back to it by hand.
    // Proved by a day that only exists in the month being shown.
    const user = userEvent.setup();
    render(<DatePicker value="2026-12-31" onChange={vi.fn()} />);

    await open(user, /31 December 2026/);

    expect(
      screen.getByRole("button", { name: /December 1st, 2026/ })
    ).toBeInTheDocument();
  });

  it("hands back yyyy-mm-dd for the day that was clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DatePicker value="2026-12-31" onChange={onChange} />);
    await open(user, /31 December 2026/);

    await user.click(screen.getByRole("button", { name: /December 15th, 2026/ }));

    expect(onChange).toHaveBeenCalledWith("2026-12-15");
  });

  it("does not shift the day by one, in a negative-offset timezone", async () => {
    // The whole reason isoDate.js exists. A Date built for the 1st and put
    // through toISOString in America/New_York reads as the previous day, so this
    // is the assertion that catches a formatter reaching for UTC.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DatePicker value="2026-12-31" onChange={onChange} />);
    await open(user, /31 December 2026/);

    await user.click(screen.getByRole("button", { name: /December 1st, 2026/ }));

    expect(onChange).toHaveBeenCalledWith("2026-12-01");
  });

  it("closes once a day is chosen", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-12-31" onChange={vi.fn()} />);
    await open(user, /31 December 2026/);

    await user.click(screen.getByRole("button", { name: /December 15th, 2026/ }));

    expect(screen.queryByRole("grid")).toBeNull();
  });
});
