import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Landing from "./Landing";
import { FAQ, FOOTER } from "./content";

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

describe("Landing: the FAQ disclosure", () => {
  it("opens the first question in each group and leaves the rest closed", () => {
    render(<Landing />);

    for (const group of FAQ.groups) {
      group.items.forEach((item, index) => {
        const toggle = screen.getByRole("button", { name: item.q });
        expect(toggle).toHaveAttribute("aria-expanded", index === 0 ? "true" : "false");
      });
    }
  });

  it("shows three answers on arrival, so the section is useful without a click", () => {
    render(<Landing />);
    for (const group of FAQ.groups) {
      expect(screen.getByText(group.items[0].a)).toBeVisible();
    }
  });

  it("reveals an answer when its question is activated", async () => {
    const user = userEvent.setup();
    render(<Landing />);

    const closed = FAQ.groups[0].items[1];
    expect(screen.getByText(closed.a)).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: closed.q }));

    expect(screen.getByText(closed.a)).toBeVisible();
    expect(screen.getByRole("button", { name: closed.q })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
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
    global.fetch.mockResolvedValue({ ok: false, status: 404 });
    const user = userEvent.setup();
    render(<Landing />);

    const { field, submit } = heroWaitlist();
    await user.type(field, "maya@example.com");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(/404/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

describe("Landing: sign in", () => {
  it("hands over rather than handling auth itself", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<Landing onSignIn={onSignIn} />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
