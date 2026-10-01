import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/guide.js", () => ({ startTour: vi.fn(async () => false) }));

const { StepComplete } = await import("./StepComplete");
const { countAdded } = await import("./OnboardingFlow");

const connected = { connection: { state: "connected", name: "Cursor" } };

describe("countAdded", () => {
  it("counts what you typed, not what was already there", () => {
    const before = {
      profile: { name: "" },
      preferences: { communication: { default: { locale: "British English" } } },
    };
    const after = { ...before, profile: { name: "Ada", current_role: "Engineer" } };
    expect(countAdded(before, after)).toBe(2);
    expect(countAdded(before, before)).toBe(0);
  });

  it("counts an extra added on Complete", () => {
    const before = { goals: { goals: [] } };
    expect(countAdded(before, { goals: { goals: [{ title: "Learn Rust" }] } })).toBe(1);
  });
});

describe("StepComplete", () => {
  it("says who can read it now", () => {
    render(<StepComplete added={3} report={connected} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText("You've added 3 things. Cursor can read them now.")).toBeInTheDocument();
  });

  it("says what connecting would do when nothing is connected", () => {
    render(<StepComplete added={1} report={null} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(
      screen.getByText("You've added 1 thing. Connect an assistant and it can read them and suggest the rest."),
    ).toBeInTheDocument();
  });

  it("is honest about nothing", () => {
    render(<StepComplete added={0} report={null} onAdd={vi.fn()} onDone={vi.fn()} />);
    expect(
      screen.getByText("Nothing added yet. Fill it in whenever you like, or let an assistant do it."),
    ).toBeInTheDocument();
  });

  it("confirms an extra where it was added", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete added={0} report={null} onAdd={onAdd} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText("A goal you're working towards"), "Learn Rust{Enter}");
    expect(onAdd).toHaveBeenCalledWith("goals", ["goals"], { title: "Learn Rust" });
    expect(screen.getByRole("status")).toHaveTextContent("Added to Goals");
  });

  it("adds a top-of-mind item under projects", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<StepComplete added={0} report={null} onAdd={onAdd} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText("What's on your mind at the moment?"), "The migration");
    await user.click(screen.getByRole("button", { name: "Add this" }));
    expect(onAdd).toHaveBeenCalledWith("projects", ["top_of_mind"], { idea: "The migration" });
    expect(screen.getByRole("status")).toHaveTextContent("Added to Top of mind");
  });

  it("goes to the persona", async () => {
    const onDone = vi.fn();
    render(<StepComplete added={0} report={null} onAdd={vi.fn()} onDone={onDone} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Go to my persona" }));
    expect(onDone).toHaveBeenCalled();
  });
});
