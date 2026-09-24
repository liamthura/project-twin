import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SectionMenu } from "./SectionMenu";
import packs from "@/__fixtures__/packs.json";
import { outline } from "@/renderers/paths";

const preferences = packs.find((p) => p.key === "preferences");
const profile = packs.find((p) => p.key === "profile");
const learningLog = packs.find((p) => p.key === "learning_log");
const PACKS = [profile, preferences, learningLog];

function renderMenu(props = {}) {
  return render(
    <SectionMenu
      packs={PACKS}
      activeSection="preferences"
      activeBand={null}
      pendingCount={0}
      onNavigate={vi.fn()}
      {...props}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: /Preferences/ });
const sheet = () => screen.getByRole("menu");

describe("SectionMenu", () => {
  it("names the section you are in, on the trigger", () => {
    renderMenu();
    expect(trigger()).toBeInTheDocument();
  });

  it("names Review and Sections too, which are not packs", () => {
    renderMenu({ activeSection: "review" });
    expect(screen.getByRole("button", { name: /Review/ })).toBeInTheDocument();
  });

  it("lists every destination once opened", async () => {
    renderMenu();
    await userEvent.click(trigger());
    for (const p of PACKS) {
      expect(within(sheet()).getByRole("menuitem", { name: new RegExp(p.title) })).toBeInTheDocument();
    }
    const names = within(sheet()).getAllByRole("menuitem").map((b) => b.textContent.trim());
    // Same order as the rail: Review leads.
    expect(names.find((n) => /Review|Profile|Preferences/.test(n))).toMatch(/^Review/);
    expect(within(sheet()).queryByRole("menuitem", { name: /^Sections$/ })).not.toBeInTheDocument();
  });

  it("links to Settings -> Sections from the phone too", async () => {
    const onNavigate = vi.fn();
    renderMenu({ onNavigate });
    await userEvent.click(trigger());
    await userEvent.click(within(sheet()).getByRole("menuitem", { name: "Manage sections" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "sections");
  });

  it("nests the active section's bands beneath it, and no other section's", async () => {
    renderMenu();
    await userEvent.click(trigger());
    for (const band of outline(preferences)) {
      expect(within(sheet()).getByRole("menuitem", { name: band.label })).toBeInTheDocument();
    }
    expect(
      within(sheet()).queryByRole("menuitem", { name: "Work Experience" })
    ).not.toBeInTheDocument();
  });

  it("nests nothing under a section whose children are all untitled", async () => {
    renderMenu({ activeSection: "learning_log" });
    await userEvent.click(screen.getByRole("button", { name: /Learning/ }));
    expect(outline(learningLog)).toEqual([]);
    expect(within(sheet()).getByRole("menuitem", { name: /Learning/ })).toBeInTheDocument();
  });

  it("puts any subsection two taps away", async () => {
    // The whole argument for replacing the strip. One tap opens, one tap
    // arrives -- no scrolling on a second axis to find the tab first.
    const onNavigate = vi.fn();
    renderMenu({ onNavigate });
    await userEvent.click(trigger()); // tap one
    await userEvent.click(within(sheet()).getByRole("menuitem", { name: "Communication" })); // tap two
    expect(onNavigate).toHaveBeenCalledWith("preferences", "communication");
  });

  it("reports a section choice with a null band", async () => {
    const onNavigate = vi.fn();
    renderMenu({ onNavigate });
    await userEvent.click(trigger());
    await userEvent.click(within(sheet()).getByRole("menuitem", { name: /Profile/ }));
    expect(onNavigate).toHaveBeenCalledWith("profile", null);
  });

  it("closes on navigating, rather than covering what it scrolled to", async () => {
    renderMenu();
    await userEvent.click(trigger());
    expect(sheet()).toBeInTheDocument();
    await userEvent.click(within(sheet()).getByRole("menuitem", { name: "Code Style" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks the current section and band inside the menu", async () => {
    renderMenu({ activeBand: "communication" });
    await userEvent.click(trigger());
    expect(within(sheet()).getByRole("menuitem", { name: /Preferences/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(sheet()).getByRole("menuitem", { name: "Communication" })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("shows Review's pending count as a number", async () => {
    renderMenu({ pendingCount: 4 });
    await userEvent.click(trigger());
    const review = within(sheet()).getByRole("menuitem", { name: /Review/ });
    expect(within(review).getByText("4")).toBeInTheDocument();
  });

  it("is hidden above the mobile breakpoint, where the rail takes over", () => {
    const { container } = renderMenu();
    expect(container.firstChild.className).toContain("md:hidden");
  });

  it("sticks under the header rather than scrolling away", () => {
    const { container } = renderMenu();
    expect(container.firstChild.className).toContain("sticky");
    expect(container.firstChild.className).toContain("top-[60px]");
  });
});
