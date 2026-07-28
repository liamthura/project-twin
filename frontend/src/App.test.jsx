import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packsFixture from "@/__fixtures__/packs.json";
import circleData from "@/__fixtures__/data/circle.json";
import learningLogData from "@/__fixtures__/data/learning_log.json";

// App.jsx only ever reaches the network through `api`/`getAuthToken`, but it
// also unconditionally renders <ConnectionSettings> (just hidden), which
// imports several other named exports (CLOUD_API_URL, getApiBase, ...) from
// this same module. A mock that only replaces api/getAuthToken and drops the
// rest makes React throw the moment that component mounts -- well after
// these tests' own assertions would otherwise have passed -- so this keeps
// every real export and overrides only the two App.jsx's data flow uses.
vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: vi.fn(),
    getAuthToken: vi.fn(() => "test-token"),
  };
});

import { api } from "@/lib/api.js";
import App from "@/App";

// jsdom implements neither. App's theme effect calls matchMedia and the
// tab-strip edge-fade effect (useEdgeFade) constructs a ResizeObserver on
// every render regardless of which section is being exercised -- without
// these stubs, rendering <App /> throws before any assertion runs, for
// every test in this file, not just ones that touch theme or scrolling.
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

// A minimal but complete /all payload: one key per BESPOKE_EDITORS entry
// (now excluding circle and learning_log) plus the two packs under test,
// using the same fixtures SectionRenderer.test.jsx already trusts.
const ALL_DATA = {
  profile: {},
  knowledge: {},
  preferences: {},
  projects: {},
  lifestyle: {},
  circle: circleData,
  learning_log: learningLogData,
};

function mockApi({ packs, disabledSections = [] }) {
  api.mockImplementation((endpoint, opts) => {
    if (endpoint === "/all" && opts?.method === "PUT") {
      return Promise.resolve({});
    }
    if (endpoint === "/all") {
      return Promise.resolve({ data: ALL_DATA });
    }
    if (endpoint === "/settings") {
      return Promise.resolve({ disabled_sections: disabledSections, packs });
    }
    return Promise.resolve({});
  });
}

describe("App: circle and learning_log render through the renderer kit", () => {
  it("renders Circle and Learning Log after Preferences, in manifest position order, keeping their original icons", async () => {
    mockApi({ packs: packsFixture });
    render(<App />);

    const tabs = await screen.findAllByRole("tab");
    const names = tabs.map((t) => t.textContent);
    const prefIdx = names.indexOf("Preferences");
    const circleIdx = names.indexOf("Circle");
    const learningIdx = names.indexOf("Learning Log");

    // Both now come from the dynamicPacks loop, which is rendered after the
    // Preferences trigger; manifest position (circle 60, learning_log 70)
    // decides their relative order within that loop.
    expect(prefIdx).toBeGreaterThan(-1);
    expect(circleIdx).toBeGreaterThan(prefIdx);
    expect(learningIdx).toBeGreaterThan(circleIdx);

    // PACK_ICONS falling back to the generic Package icon for either key
    // would still pass every other assertion in this file -- only the
    // rendered icon class distinguishes "kept its icon" from "fell back".
    expect(tabs[circleIdx].querySelector(".lucide-users")).toBeInTheDocument();
    expect(tabs[circleIdx].querySelector(".lucide-package")).not.toBeInTheDocument();
    expect(tabs[learningIdx].querySelector(".lucide-book-open")).toBeInTheDocument();
    expect(tabs[learningIdx].querySelector(".lucide-package")).not.toBeInTheDocument();
  });

  it("opens the Learning Log content under its new tab value (learning_log, not learning)", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    const learningTab = await screen.findByRole("tab", { name: /learning log/i });
    await user.click(learningTab);

    // dynamicPacks renders both the trigger and the content with value={p.key}
    // ("learning_log"). If the two ever disagreed -- e.g. a leftover
    // value="learning" on one side -- clicking the trigger would never
    // reveal this content, and Radix would just show nothing selected.
    expect(await screen.findByText("React Server Components")).toBeInTheDocument();
  });

  it("hides the Circle tab when disabled via p.enabled, not the deleted disabledSections guard", async () => {
    const packs = packsFixture.map((p) =>
      p.key === "circle" ? { ...p, enabled: false } : p
    );
    mockApi({ packs, disabledSections: ["circle"] });
    render(<App />);

    // Wait for settings to actually load before asserting an absence --
    // otherwise this would trivially pass while packs is still [].
    await screen.findByRole("tab", { name: /learning log/i });
    expect(screen.queryByRole("tab", { name: /^circle$/i })).not.toBeInTheDocument();
  });

  it("saveAll flows circle and learning_log through ...packData now that neither is a bespoke editor", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("tab", { name: /^circle$/i });

    // Auto-save is on by default, which hides the manual "Save changes"
    // button. Turning it off does NOT itself save (App.jsx only saves on the
    // ON transition), so this reveals the button without saveAll firing yet.
    await user.click(screen.getByRole("switch", { name: "Auto-save" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const putAll = api.mock.calls.find(
        ([endpoint, opts]) => endpoint === "/all" && opts?.method === "PUT"
      );
      expect(putAll).toBeTruthy();
      const body = JSON.parse(putAll[1].body);
      // Before this task, saveAll sent these explicitly by name. After
      // removing both from BESPOKE_EDITORS they must still arrive, now via
      // packData -- a silent regression here would stop both sections
      // saving without any error surfacing anywhere.
      expect(body.circle).toEqual(circleData);
      expect(body.learning_log).toEqual(learningLogData);
    });
  });
});
