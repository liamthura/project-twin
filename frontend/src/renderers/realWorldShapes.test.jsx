import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";

import packs from "@/__fixtures__/packs.json";
import { renderSection } from "@/test/harness";

// Shapes taken from a real production record, with the content replaced. The
// committed fixtures are tidy by construction -- every enum value legal, every
// declared key present -- and tidy fixtures are exactly what let wave 6 bind
// `coursework` as chips and pass its whole suite while crashing on real data.
//
// These assert the two properties a real record depends on and a tidy fixture
// never exercises:
//
//   1. Keys no `ui` node binds survive an edit. A production `preferences`
//      holds `design`, `work_preferences`, `response_format` and `coding`; a
//      `profile` holds `contact.github` and machine `id`s. None are bound by
//      any node -- and none were bound by the editors these replaced either.
//      They must round-trip untouched, or migrating the UI silently deletes
//      data no screen ever showed.
//   2. Enum values that predate the current option set still render. Real
//      hobbies carry `skill_level: "enthusiast"` and `"casual"`; real
//      languages carry `fluency: "professional"`. None are in the manifests'
//      valid_values, and none were in the retired editors' either.
const lifestylePack = packs.find((p) => p.key === "lifestyle");
const preferencesPack = packs.find((p) => p.key === "preferences");
const profilePack = packs.find((p) => p.key === "profile");

describe("a record shaped like production", () => {
  describe("keys no node binds", () => {
    it("keeps unbound preferences sections through an edit", async () => {
      const data = {
        // Bound.
        code_style: { tools: ["Docker"], frameworks: [], preferred_languages: [] },
        likes_dislikes: [{ id: "taste_1", item: "cheesy copy", stance: "dislike" }],
        // Unbound -- no node addresses any of these.
        design: { frontend_aesthetic: "a long prose block" },
        work_preferences: { timezone: "GMT/BST (UK)" },
        response_format: { prefer_code_blocks: true },
        coding: { editor: "VSCode" },
      };
      const { user, latest } = renderSection({ pack: preferencesPack, initial: data });

      await user.type(within(uiNode("Tools")).getByRole("textbox"), "Git{Enter}");

      expect(latest().code_style.tools).toEqual(["Docker", "Git"]);
      expect(latest().design).toEqual(data.design);
      expect(latest().work_preferences).toEqual(data.work_preferences);
      expect(latest().response_format).toEqual(data.response_format);
      expect(latest().coding).toEqual(data.coding);
    });

    it("keeps a nested unbound key beside a bound sibling", async () => {
      // `code_style.conventions` sits inside a bound object whose OTHER keys
      // are bound -- the case a whole-object write would clobber.
      const data = {
        code_style: {
          tools: ["Docker"],
          conventions: { indent_size: 2, prefer_types: true },
        },
      };
      const { user, latest } = renderSection({ pack: preferencesPack, initial: data });

      await user.type(within(uiNode("Tools")).getByRole("textbox"), "Git{Enter}");

      expect(latest().code_style.conventions).toEqual(data.code_style.conventions);
    });

    it("keeps machine ids and legacy contact scalars on profile", async () => {
      const data = {
        name: "A Name",
        contact: {
          emails: [{ address: "a@b.co", purpose: "work" }],
          links: [],
          github: "someuser",
          linkedin: "someuser",
        },
        languages_spoken: [{ id: "language_1", name: "English", fluency: "native" }],
      };
      const { user, latest } = renderSection({ pack: profilePack, initial: data });

      const preferred = screen.getByLabelText("Preferred name");
      await user.type(preferred, "X");

      expect(latest().contact.github).toBe("someuser");
      expect(latest().contact.linkedin).toBe("someuser");
      expect(latest().languages_spoken[0].id).toBe("language_1");
    });

    it("keeps an unbound lifestyle section through an edit", async () => {
      const data = {
        values: ["Ownership"],
        media: { games: ["Minecraft"], favourite_genres: ["sci-fi"] },
      };
      const { user, latest } = renderSection({ pack: lifestylePack, initial: data });

      await user.type(within(uiNode("Values")).getByRole("textbox"), "Candour{Enter}");

      expect(latest().values).toEqual(["Ownership", "Candour"]);
      expect(latest().media).toEqual(data.media);
    });
  });

  describe("enum values older than the current option set", () => {
    const legacyHobbies = {
      hobbies: [
        {
          id: "hobby_1",
          name: "Badminton",
          skill_level: "enthusiast", // not in valid_values
          status: "active",
          specifics: [],
          references: [],
        },
        // No `status` key at all -- most real rows predate the field.
        { id: "hobby_2", name: "Films", skill_level: "casual", specifics: [], references: [] },
      ],
    };

    it("renders a hobby whose skill_level predates the option set", () => {
      renderSection({ pack: lifestylePack, initial: legacyHobbies });
      expect(screen.getByText("Badminton")).toBeInTheDocument();
      expect(screen.getByText("Films")).toBeInTheDocument();
    });

    it("shows the stored value rather than dropping it, and marks it legacy", async () => {
      // `skill_level` has five options, past SEGMENTED_MAX, so it renders as a
      // dropdown rather than segmented buttons -- the legacy value shows in
      // the trigger with a dashed border instead of as a pressed chip.
      const { user } = renderSection({ pack: lifestylePack, initial: legacyHobbies });
      await user.click(screen.getByText("Badminton"));

      const trigger = screen
        .getAllByRole("combobox")
        .find((el) => el.textContent.includes("enthusiast"));
      expect(trigger, "the stored value is not shown anywhere").toBeTruthy();
      expect(trigger).toHaveAttribute("title", expect.stringContaining("not in the current option"));
      expect(trigger.className).toContain("border-dashed");
    });

    it("does not rewrite a legacy value when an unrelated field is edited", async () => {
      // The real hazard: touching notes must not quietly normalise skill_level
      // to something in the current set.
      const { user, latest } = renderSection({ pack: lifestylePack, initial: legacyHobbies });
      await user.click(screen.getByText("Badminton"));

      const notes = screen.getByText("notes").parentElement;
      await user.type(within(notes).getByRole("textbox"), "one session a week");

      expect(latest().hobbies[0].skill_level).toBe("enthusiast");
      expect(latest().hobbies[1].skill_level).toBe("casual");
    });

    it("renders a row with no status key at all", async () => {
      const { user, latest } = renderSection({ pack: lifestylePack, initial: legacyHobbies });
      await user.click(screen.getByText("Films"));

      // Nothing is invented for the missing key until the user picks one.
      expect(latest().hobbies[1].status).toBeUndefined();
    });
  });

  function uiNode(title) {
    const el = document.querySelector(`[data-ui-node="${title}"]`);
    if (!el) throw new Error(`no ui node titled "${title}" is rendered`);
    return el;
  }
});
