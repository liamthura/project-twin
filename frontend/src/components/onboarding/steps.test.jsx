import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packs from "@/__fixtures__/packs.json";

import { StepAboutYou } from "./StepAboutYou";
import { StepHowYouLike } from "./StepHowYouLike";

describe("StepAboutYou", () => {
  it("renders the profile root scalars through the editor's own renderer", () => {
    render(<StepAboutYou packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Preferred name")).toBeInTheDocument();
    expect(screen.getByLabelText("Current role")).toBeInTheDocument();
    expect(screen.getByLabelText("Organisation")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.getByLabelText("Bio")).toBeInTheDocument();
  });

  it("hands the whole section back on an edit, keys it does not render included", async () => {
    // The stored profile object carries lists this step never shows. A write
    // that dropped them would delete someone's work history for typing a name.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StepAboutYou
        packs={packs}
        data={{ work_experience: [{ company: "Acme" }] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "A");
    expect(onChange).toHaveBeenCalledWith({
      work_experience: [{ company: "Acme" }],
      name: "A",
    });
  });

  it("says nothing is required", () => {
    render(<StepAboutYou packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/nothing here is required/i)).toBeInTheDocument();
  });

  it("renders an explanation rather than throwing when the pack is absent", () => {
    // A disabled section, or a server that does not ship this pack.
    render(<StepAboutYou packs={[]} data={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/not available on this server/i)).toBeInTheDocument();
  });
});

describe("StepHowYouLike", () => {
  it("renders tone, locale and detail level", () => {
    render(<StepHowYouLike packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Tone")).toBeInTheDocument();
    expect(screen.getByLabelText("Locale")).toBeInTheDocument();
    expect(screen.getByLabelText("Detail level")).toBeInTheDocument();
  });

  it("gives detail level a textarea, because the manifest types it longtext", () => {
    render(<StepHowYouLike packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Detail level").tagName).toBe("TEXTAREA");
  });

  it("writes tone under communication.default, not at the root", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StepHowYouLike packs={packs} data={{}} onChange={onChange} />);

    await user.type(screen.getByLabelText("Tone"), "d");
    expect(onChange).toHaveBeenCalledWith({
      communication: { default: { tone: "d" } },
    });
  });

  it("is a section of About you, not a page: an h2, and no response format", () => {
    render(<StepHowYouLike packs={packs} data={{}} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /how you like answers/i, level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add response format/i })).not.toBeInTheDocument();
  });

  it("renders nothing on a server without the node", () => {
    const { container } = render(<StepHowYouLike packs={[]} data={{}} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps preferences keys it never renders", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StepHowYouLike
        packs={packs}
        data={{ likes_dislikes: [{ item: "jargon", stance: "dislike" }] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText("Locale"), "B");
    expect(onChange).toHaveBeenCalledWith({
      likes_dislikes: [{ item: "jargon", stance: "dislike" }],
      communication: { default: { locale: "B" } },
    });
  });
});

describe.each([
  ["with the pack", packs],
  ["without it", []],
])("About you offers the way out of typing (%s)", (_label, packsForCase) => {
  it("offers it on About you", async () => {
    const onOfferAssistant = vi.fn();
    const user = userEvent.setup();
    render(
      <StepAboutYou
        packs={packsForCase}
        data={{}}
        onChange={vi.fn()}
        onOfferAssistant={onOfferAssistant}
      />,
    );

    await user.click(screen.getByRole("button", { name: /let my assistant fill this in/i }));
    expect(onOfferAssistant).toHaveBeenCalled();
  });

  it("stays out of the way when there is nowhere to go", () => {
    // No handler means the flow did not wire one, and a button that does
    // nothing is worse than no button.
    render(<StepAboutYou packs={packsForCase} data={{}} onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /let my assistant fill this in/i }),
    ).not.toBeInTheDocument();
  });
});
