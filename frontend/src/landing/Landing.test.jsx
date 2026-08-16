import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Landing from "./Landing";
import { FAQ, FOOTER, CLIENTS as HERO_CLIENTS } from "./content";
import { hasMark } from "@/lib/clients.js";

// Reduced motion, deliberately, and only in this file.
//
// The section entrances start at opacity 0 and animate in. jsdom runs no
// animation frames, so without this every assertion about content inside a
// section fails toBeVisible() on an element that is present and correct.
// Reporting reduced motion takes blur-fade's plain-div path -- which is the
// branch these tests should exercise anyway, since they assert on content
// rather than on whether a transition played.
//
// Scoped here rather than added to src/test/setup.js: a global stub overrides
// the per-file ones other suites already install, and doing that broke 29
// tests across six files that depend on their own matchMedia answers.
beforeAll(() => {
  window.matchMedia = (query) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

describe("Landing: the FAQ disclosure", () => {
  it("ships every question closed", () => {
    render(<Landing />);

    for (const group of FAQ.groups) {
      for (const item of group.items) {
        expect(screen.getByRole("button", { name: item.q })).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      }
    }
  });

  it("keeps collapsed answers out of the accessibility tree", () => {
    // grid-rows-[0fr] hides an answer visually. Without aria-hidden a screen
    // reader still reads all nine straight through, which is the opposite of
    // what a disclosure is for.
    render(<Landing />);
    const answer = screen.getByText(FAQ.groups[0].items[0].a);
    expect(answer).toHaveAttribute("aria-hidden", "true");
  });

  it("reveals an answer when its question is activated", async () => {
    const user = userEvent.setup();
    render(<Landing />);

    const item = FAQ.groups[0].items[0];
    await user.click(screen.getByRole("button", { name: item.q }));

    expect(screen.getByRole("button", { name: item.q })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(item.a)).not.toHaveAttribute("aria-hidden", "true");
  });

  it("closes again on a second activation", async () => {
    const user = userEvent.setup();
    render(<Landing />);

    const item = FAQ.groups[1].items[0];
    const toggle = screen.getByRole("button", { name: item.q });
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(item.a)).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Landing: the waitlist field", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The hero form. Scoped deliberately: the nav CTA carries the same
   *  accessible name, because it is the same action. */
  function heroWaitlist() {
    const field = screen.getAllByRole("textbox", { name: /email address/i })[0];
    const form = field.closest("form");
    return { field, form, submit: within(form).getByRole("button") };
  }

  it("rejects a malformed address without calling the server", async () => {
    const user = userEvent.setup();
    render(<Landing />);

    const { field, submit } = heroWaitlist();
    await user.type(field, "not-an-email");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /does not look like an email address/i,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirms in place once the address is accepted", async () => {
    const user = userEvent.setup();
    render(<Landing />);

    const { field, submit } = heroWaitlist();
    await user.type(field, "maya@example.com");
    await user.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent(/you're on the list/i);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/waitlist",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a failure rather than pretending it worked", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => null });
    const user = userEvent.setup();
    render(<Landing />);

    const { field, submit } = heroWaitlist();
    await user.type(field, "maya@example.com");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("repeats the server's reason when it rejects the address", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: "That does not look like an email address." }),
    });
    const user = userEvent.setup();
    render(<Landing />);

    // Passes this component's own check, so only the server can reject it.
    const { field, submit } = heroWaitlist();
    await user.type(field, "maya@example.x");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /does not look like an email address/i,
    );
  });
});

describe("Landing: links that have nowhere to go", () => {
  it("renders GitHub, Privacy and Terms as text, not as dead anchors", () => {
    render(<Landing />);
    const footer = screen.getByRole("contentinfo");

    const undestined = FOOTER.groups
      .flatMap((g) => g.links)
      .filter((l) => l.href === null)
      .map((l) => l.label);

    expect(undestined).toEqual(["GitHub", "Privacy", "Terms"]);
    for (const label of undestined) {
      expect(within(footer).getByText(label).tagName).not.toBe("A");
    }
  });
});

describe("the hero chips", () => {
  it("takes which marks exist from the roster rather than a second copy", () => {
    for (const chip of HERO_CLIENTS) {
      expect(chip.mark, `${chip.slug} chip`).toBe(hasMark(chip.slug));
    }
  });
});

describe("Landing: sign in", () => {
  it("hands over rather than handling auth itself", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<Landing onSignIn={onSignIn} />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
