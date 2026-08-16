// canvas-confetti calls getContext("2d"), which jsdom does not implement. The
// mock keeps every StepComplete test off that path; whether confetti fired is
// asserted through this spy rather than through the canvas.
const confettiCreateMock = vi.hoisted(() => vi.fn(() => Object.assign(vi.fn(), { reset: vi.fn() })));
vi.mock("canvas-confetti", () => ({
  default: Object.assign(vi.fn(), { create: confettiCreateMock }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StepComplete } from "./StepComplete";

const filled = {
  profile: { name: "Ada", preferred_name: "", bio: "Builds things." },
  preferences: { communication: { default: { tone: "direct" } } },
};

describe("StepComplete", () => {
  it("counts what was actually filled, not what was offered", () => {
    render(<StepComplete data={filled} onAdd={vi.fn()} onDone={vi.fn()} />);
    // name and bio on profile, tone on preferences. preferred_name is empty and
    // must not be counted -- a count that included it would congratulate
    // someone for a field they skipped.
    expect(screen.getByText(/3 things saved/i)).toBeInTheDocument();
  });

  it("says so plainly when nothing was filled", () => {
    render(<StepComplete data={{}} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();
  });

  it("appends one top-of-mind idea in the shape the entity declares", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText(/what is on your mind/i), "Ship the flow");
    await user.click(screen.getByRole("button", { name: /add this/i }));

    expect(onAdd).toHaveBeenCalledWith("projects", ["top_of_mind"], {
      idea: "Ship the flow",
    });
  });

  it("appends one goal by its title field", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText(/one goal/i), "Learn Rust");
    await user.click(screen.getByRole("button", { name: /add goal/i }));

    expect(onAdd).toHaveBeenCalledWith("goals", ["goals"], { title: "Learn Rust" });
  });

  it("adds nothing for whitespace, and clears the box after a real add", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={onAdd} onDone={vi.fn()} />);

    const box = screen.getByLabelText(/what is on your mind/i);
    await user.type(box, "   ");
    await user.click(screen.getByRole("button", { name: /add this/i }));
    expect(onAdd).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, "Ship it");
    await user.click(screen.getByRole("button", { name: /add this/i }));
    expect(box).toHaveValue("");
  });

  it("has one way into the app", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete data={filled} onAdd={vi.fn()} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: /go to my persona/i }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("StepComplete, the arrival", () => {
  // Nothing in vitest.config.js clears mocks between tests, and this file has
  // several renders of StepComplete before these run -- without this, a
  // confetti assertion could pass on a call left over from an earlier test
  // rather than on its own render.
  beforeEach(() => {
    confettiCreateMock.mockClear();
  });

  it("counts one saved field as one thing, not '1 things'", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 thing saved/)).toBeInTheDocument();
    expect(screen.queryByText(/1 things saved/)).not.toBeInTheDocument();
  });

  it("still pluralises more than one", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam", current_role: "Specialist" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(/things saved/)).toBeInTheDocument();
  });

  it("celebrates arriving with something saved", () => {
    render(
      <StepComplete
        data={{ profile: { name: "Liam" } }}
        onAdd={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(confettiCreateMock).toHaveBeenCalled();
  });

  it("does not celebrate an empty persona", () => {
    // Nothing was saved. Confetti over that is a party for a job not done, and
    // the copy beside it already says as much.
    render(<StepComplete data={{}} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(confettiCreateMock).not.toHaveBeenCalled();
  });
});
