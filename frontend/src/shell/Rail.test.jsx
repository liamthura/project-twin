import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Rail } from "./Rail";
import packs from "@/__fixtures__/packs.json";
import { outline } from "@/renderers/paths";

const preferences = packs.find((p) => p.key === "preferences");
const profile = packs.find((p) => p.key === "profile");
const learningLog = packs.find((p) => p.key === "learning_log");
const PACKS = [profile, preferences, learningLog];

const rail = () => screen.getByRole("navigation", { name: "Sections" });
const item = (name) => screen.getByRole("button", { name: new RegExp(name) });

function renderRail(props = {}) {
  return render(
    <Rail
      packs={PACKS}
      activeSection="preferences"
      activeBand={null}
      pendingCount={0}
      version="v2.0.0 (abc1234)"
      onNavigate={vi.fn()}
      {...props}
    />
  );
}

describe("Rail", () => {
  it("lists every pack, plus Review and Sections", () => {
    renderRail();
    for (const p of PACKS) expect(item(p.title)).toBeInTheDocument();
    expect(item("Review")).toBeInTheDocument();
    expect(item("Sections")).toBeInTheDocument();
  });

  it("marks the active section, and only it", () => {
    renderRail();
    expect(item("Preferences")).toHaveAttribute("aria-current", "page");
    expect(item("Profile")).not.toHaveAttribute("aria-current");
  });

  it("expands the active section's bands, and no others", () => {
    renderRail();
    for (const band of outline(preferences)) {
      expect(screen.getByRole("button", { name: band.label })).toBeInTheDocument();
    }
    // Profile is not active, so its bands must not be on screen -- the
    // prototype is explicit that switching collapses the previous section.
    expect(screen.queryByRole("button", { name: "Work Experience" })).not.toBeInTheDocument();
  });

  it("expands nothing for a section whose children are all untitled", () => {
    renderRail({ activeSection: "learning_log" });
    expect(outline(learningLog)).toEqual([]);
    expect(document.querySelector("[data-spy-marker]")).toBeNull();
  });

  it("expands nothing for Review and Sections, which are not packs", () => {
    renderRail({ activeSection: "review" });
    expect(screen.queryByRole("button", { name: "Code Style" })).not.toBeInTheDocument();
  });

  it("shows the marker only once a band is current", () => {
    const { rerender } = renderRail();
    expect(document.querySelector("[data-spy-marker]")).toBeNull();
    rerender(
      <Rail
        packs={PACKS}
        activeSection="preferences"
        activeBand="code-style"
        pendingCount={0}
        onNavigate={vi.fn()}
      />
    );
    expect(document.querySelector("[data-spy-marker]")).not.toBeNull();
  });

  it("moves the marker by whole rows, so it slides rather than cuts", () => {
    // One element translated between rows. Two markers, one per row, could not
    // animate between each other at all -- CSS has nothing to interpolate.
    renderRail({ activeBand: "communication" });
    const marker = document.querySelector("[data-spy-marker]");
    // Communication is index 1 of Preferences' four bands.
    expect(marker.style.transform).toBe("translateY(32px)");
    expect(marker.className).toContain("duration-medium");
    expect(marker.className).toContain("ease-standard");
  });

  it("marks the current band on its own row too, not only with the marker", () => {
    renderRail({ activeBand: "communication" });
    expect(screen.getByRole("button", { name: "Communication" })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByRole("button", { name: "Code Style" })).not.toHaveAttribute("aria-current");
  });

  it("reports a section click with a null band", async () => {
    const onNavigate = vi.fn();
    renderRail({ onNavigate });
    await userEvent.click(item("Profile"));
    expect(onNavigate).toHaveBeenCalledWith("profile", null);
  });

  it("reports a band click with the section and the band id", async () => {
    const onNavigate = vi.fn();
    renderRail({ onNavigate });
    await userEvent.click(screen.getByRole("button", { name: "Likes & Dislikes" }));
    expect(onNavigate).toHaveBeenCalledWith("preferences", "likes-dislikes");
  });

  it("shows Review's pending count as a number", () => {
    renderRail({ pendingCount: 3 });
    expect(within(item("Review")).getByText("3")).toBeInTheDocument();
  });

  it("shows no count at all when nothing is pending", () => {
    renderRail({ pendingCount: 0 });
    expect(within(item("Review")).queryByText("0")).not.toBeInTheDocument();
  });

  it("rules Review and Sections off from the persona sections", () => {
    // The divider carries meaning: those two are not sections of the profile and
    // must not read as though they were.
    renderRail();
    expect(rail().querySelector("hr")).not.toBeNull();
  });

  it("shows the build version, in mono, at the foot", () => {
    renderRail();
    const version = screen.getByText("v2.0.0 (abc1234)");
    expect(version.className).toContain("font-mono");
  });

  it("sticks below the header rather than scrolling away with the page", () => {
    renderRail();
    expect(rail().className).toContain("sticky");
    expect(rail().className).toContain("top-[60px]");
    expect(rail().className).toContain("w-60");
  });
});

describe("the disclosure caret", () => {
  it("appears on a section that actually has sub-items", () => {
    renderRail();
    expect(item("Preferences").querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(item("Profile").querySelector(".lucide-chevron-right")).not.toBeNull();
  });

  it("does not appear on Review or Sections, which have none", () => {
    // A caret promises something to expand. Neither of these is a persona
    // section and neither has bands, so the promise is false.
    renderRail();
    for (const name of ["Review", "Sections"]) {
      expect(item(name).querySelector(".lucide-chevron-down")).toBeNull();
      expect(item(name).querySelector(".lucide-chevron-right")).toBeNull();
    }
  });

  it("does not appear on a pack whose children are all untitled", () => {
    // learning_log's shape: one untitled list, named by the Card's own header.
    // outline() returns nothing for it, so there is nothing to disclose -- and
    // this is the case a hardcoded "packs get carets, the rest do not" rule
    // would get wrong.
    renderRail();
    expect(outline(learningLog)).toEqual([]);
    const learning = item("Learning Log");
    expect(learning.querySelector(".lucide-chevron-down")).toBeNull();
    expect(learning.querySelector(".lucide-chevron-right")).toBeNull();
  });

  it("keeps the icons aligned whether or not a caret is drawn", () => {
    // Dropping the caret entirely would shift those rows' icons left of the
    // others; the slot stays and only its contents go.
    renderRail();
    const withCaret = item("Profile").querySelector("[data-caret-slot]");
    const without = item("Review").querySelector("[data-caret-slot]");
    expect(withCaret).not.toBeNull();
    expect(without).not.toBeNull();
    expect(without.className).toBe(withCaret.className);
  });
});
