import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SectionSheet } from "./SectionSheet";
import packs from "@/__fixtures__/packs.json";
import { outline } from "@/renderers/paths";

const preferences = packs.find((p) => p.key === "preferences");
const profile = packs.find((p) => p.key === "profile");
const learningLog = packs.find((p) => p.key === "learning_log");
const PACKS = [profile, preferences, learningLog];

function renderSheet(props = {}) {
  return render(
    <SectionSheet
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
const sheet = () => screen.getByRole("dialog");

describe("SectionSheet", () => {
  it("names the section you are in, on the trigger", () => {
    renderSheet();
    expect(trigger()).toBeInTheDocument();
  });

  it("names Review and Sections too, which are not packs", () => {
    renderSheet({ activeSection: "review" });
    expect(screen.getByRole("button", { name: /Review/ })).toBeInTheDocument();
  });

  it("lists every destination once opened", async () => {
    renderSheet();
    await userEvent.click(trigger());
    for (const p of PACKS) {
      expect(within(sheet()).getByRole("button", { name: new RegExp(p.title) })).toBeInTheDocument();
    }
    expect(within(sheet()).getByRole("button", { name: /Review/ })).toBeInTheDocument();
    expect(within(sheet()).getByRole("button", { name: /Sections/ })).toBeInTheDocument();
  });

  it("nests the active section's bands beneath it, and no other section's", async () => {
    renderSheet();
    await userEvent.click(trigger());
    for (const band of outline(preferences)) {
      expect(within(sheet()).getByRole("button", { name: band.label })).toBeInTheDocument();
    }
    expect(
      within(sheet()).queryByRole("button", { name: "Work Experience" })
    ).not.toBeInTheDocument();
  });

  it("nests nothing under a section whose children are all untitled", async () => {
    renderSheet({ activeSection: "learning_log" });
    await userEvent.click(screen.getByRole("button", { name: /Learning/ }));
    expect(outline(learningLog)).toEqual([]);
    expect(within(sheet()).getByRole("button", { name: /Learning/ })).toBeInTheDocument();
  });

  it("puts any subsection two taps away", async () => {
    // The whole argument for replacing the strip. One tap opens, one tap
    // arrives -- no scrolling on a second axis to find the tab first.
    const onNavigate = vi.fn();
    renderSheet({ onNavigate });
    await userEvent.click(trigger()); // tap one
    await userEvent.click(within(sheet()).getByRole("button", { name: "Communication" })); // tap two
    expect(onNavigate).toHaveBeenCalledWith("preferences", "communication");
  });

  it("reports a section choice with a null band", async () => {
    const onNavigate = vi.fn();
    renderSheet({ onNavigate });
    await userEvent.click(trigger());
    await userEvent.click(within(sheet()).getByRole("button", { name: /Profile/ }));
    expect(onNavigate).toHaveBeenCalledWith("profile", null);
  });

  it("closes on navigating, rather than covering what it scrolled to", async () => {
    renderSheet();
    await userEvent.click(trigger());
    expect(sheet()).toBeInTheDocument();
    await userEvent.click(within(sheet()).getByRole("button", { name: "Code Style" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks the current section and band inside the sheet", async () => {
    renderSheet({ activeBand: "communication" });
    await userEvent.click(trigger());
    expect(within(sheet()).getByRole("button", { name: /Preferences/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(sheet()).getByRole("button", { name: "Communication" })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("shows Review's pending count as a number", async () => {
    renderSheet({ pendingCount: 4 });
    await userEvent.click(trigger());
    const review = within(sheet()).getByRole("button", { name: /Review/ });
    expect(within(review).getByText("4")).toBeInTheDocument();
  });

  it("is hidden above the mobile breakpoint, where the rail takes over", () => {
    const { container } = renderSheet();
    expect(container.firstChild.className).toContain("md:hidden");
  });

  it("sticks under the header rather than scrolling away", () => {
    const { container } = renderSheet();
    expect(container.firstChild.className).toContain("sticky");
    expect(container.firstChild.className).toContain("top-[60px]");
  });
});
