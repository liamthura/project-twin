import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// A minimal but complete /all payload: one key per section the app loads,
// plus the packs under test, using the same fixtures SectionRenderer.test.jsx
// already trusts. Every section is manifest-driven as of wave 6 -- there is no
// bespoke-editor carve-out left, so the whole response becomes packData.
const ALL_DATA = {
  profile: {},
  knowledge: {},
  preferences: {},
  projects: {},
  lifestyle: {},
  circle: circleData,
  learning_log: learningLogData,
};

function mockApi({ packs, disabledSections = [], pendingCount = 0 }) {
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
    if (endpoint === "/proposals/count") {
      return Promise.resolve({ entity: pendingCount, note: 0, total: pendingCount });
    }
    return Promise.resolve({});
  });
}

// The rail replaced the tab strip in slice 1, so these read buttons inside the
// navigation landmark rather than role="tab". The behaviours are unchanged --
// what is asserted is the same set of facts, through the shell that exists now.
//
// Scoped to the rail deliberately: the mobile SectionSheet is in the DOM too
// (jsdom applies no CSS, so `md:hidden` hides nothing here), and an unscoped
// query would match its trigger as well.
const rail = () => screen.getByRole("navigation", { name: "Sections" });
const railItem = (name) => within(rail()).getByRole("button", { name });
const railItems = () => within(rail()).getAllByRole("button");

describe("App: the rail says when something is waiting", () => {
  it("shows the pending count as a number on Review", async () => {
    mockApi({ packs: packsFixture, pendingCount: 3 });
    render(<App />);
    await waitFor(() =>
      expect(within(railItem(/Review/)).getByText("3")).toBeInTheDocument()
    );
  });

  it("shows no count at all when the queue is empty", async () => {
    mockApi({ packs: packsFixture, pendingCount: 0 });
    render(<App />);
    await waitFor(() => expect(railItem(/Review/)).toBeTruthy());
    expect(within(railItem(/Review/)).queryByText("0")).not.toBeInTheDocument();
  });

  it("says out loud what the number means, for anyone not looking at it", async () => {
    // "3" beside "Review" does not say three of what. The old shape was a
    // decorative dot plus sr-only text; the number is now the visible part and
    // the sentence is its label.
    mockApi({ packs: packsFixture, pendingCount: 2 });
    render(<App />);
    await waitFor(() =>
      expect(railItem(/Review/).textContent).toMatch(/2/)
    );
    expect(within(railItem(/Review/)).getByLabelText(/2 waiting/i)).toBeInTheDocument();
  });

  it("counts without marking anything seen", async () => {
    // The count polls from every section. Listing marks rows seen, which is what
    // protects them from eviction -- so it must never use that route.
    mockApi({ packs: packsFixture, pendingCount: 1 });
    render(<App />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/proposals/count"));
    const listed = api.mock.calls.filter(([e]) => String(e).startsWith("/proposals?"));
    expect(listed).toHaveLength(0);
  });
});

describe("App: circle and learning_log render through the renderer kit", () => {
  it("renders Circle and Learning Log after Preferences, in manifest position order, keeping their original icons", async () => {
    mockApi({ packs: packsFixture });
    render(<App />);

    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());
    const names = railItems().map((b) => b.textContent);
    const prefIdx = names.findIndex((n) => n.includes("Preferences"));
    const circleIdx = names.findIndex((n) => n.includes("Circle"));
    const learningIdx = names.findIndex((n) => n.includes("Learning Log"));

    expect(prefIdx).toBeGreaterThan(-1);
    expect(circleIdx).toBeGreaterThan(prefIdx);
    expect(learningIdx).toBeGreaterThan(circleIdx);

    // packIcon falling back to the generic Package icon for either key would
    // still pass every other assertion here -- only the rendered icon class
    // distinguishes "kept its icon" from "fell back".
    expect(railItems()[circleIdx].querySelector(".lucide-users")).toBeInTheDocument();
    expect(railItems()[circleIdx].querySelector(".lucide-package")).not.toBeInTheDocument();
    expect(railItems()[learningIdx].querySelector(".lucide-book-open")).toBeInTheDocument();
    expect(railItems()[learningIdx].querySelector(".lucide-package")).not.toBeInTheDocument();
  });

  it("opens the Learning Log content, and puts it in the address bar", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());
    await user.click(railItem(/Learning Log/));

    expect(await screen.findByText("React Server Components")).toBeInTheDocument();
    // A deliberate move, so it pushes -- and the key in the URL is the pack key
    // (learning_log), not a display name.
    expect(window.location.hash).toBe("#/learning_log");
  });

  it("hides the Circle item when disabled via p.enabled, not the deleted disabledSections guard", async () => {
    const packs = packsFixture.map((p) =>
      p.key === "circle" ? { ...p, enabled: false } : p
    );
    mockApi({ packs, disabledSections: ["circle"] });
    render(<App />);

    // Wait for settings to actually load before asserting an absence --
    // otherwise this would trivially pass while packs is still [].
    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());
    expect(within(rail()).queryByRole("button", { name: /^Circle$/ })).not.toBeInTheDocument();
  });

  it("saveAll flows circle and learning_log through ...packData now that neither is a bespoke editor", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());

    // Auto-save is on by default, which leaves the header chip reading "Saved"
    // with no action. The preference moved out of the header in slice 1, so
    // reaching it means opening Connection Settings -- and turning it off does
    // NOT itself save (only the ON transition flushes), so this reveals the
    // header's Save now without saveAll having fired yet.
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("switch", { name: "Auto-save" }));
    // Radix marks the rest of the page aria-hidden while a dialog is open, so
    // the header is genuinely unreachable until this closes -- which is correct
    // behaviour, and means the test has to close it like a user would.
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /save now/i }));

    await waitFor(() => {
      const putAll = api.mock.calls.find(
        ([endpoint, opts]) => endpoint === "/all" && opts?.method === "PUT"
      );
      expect(putAll).toBeTruthy();
      const body = JSON.parse(putAll[1].body);
      // saveAll used to send each bespoke section explicitly by name. As each
      // one migrated it had to keep arriving via packData instead -- a silent
      // regression here would stop a section saving with no error surfacing
      // anywhere. `profile` is the last one to make that move (wave 6), and it
      // is the one that would be missed most quietly, since the header reads
      // its name and would still render from the loaded copy.
      expect(body.circle).toEqual(circleData);
      expect(body.learning_log).toEqual(learningLogData);
      expect(body).toHaveProperty("profile");
    });
  });
});

// Clicking a rail sub-item moved the marker and the URL but never moved the
// page: navigate() set state and wrote the hash, and nothing scrolled. Reported
// from the running app, where scroll-spy worked and clicking did not.
describe("App: clicking a sub-item goes there", () => {
  beforeEach(() => {
    // jsdom keeps location.hash across tests in a file, and an earlier test in
    // this one asserts on it -- so without this the app starts on whatever
    // section ran last.
    window.location.hash = "";
  });

  it("scrolls to the band a rail click asked for", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);

    await waitFor(() => expect(railItem(/Education/)).toBeTruthy());
    await user.click(railItem(/Education/));

    await waitFor(() => {
      const target = document.querySelector('[data-band="education"]');
      expect(target).not.toBeNull();
      expect(scrollIntoView.mock.instances).toContain(target);
    });
    scrollIntoView.mockRestore();
  });

  it("puts the band in the address bar as a pushed entry", async () => {
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(railItem(/Education/)).toBeTruthy());
    await user.click(railItem(/Education/));
    expect(window.location.hash).toBe("#/profile/education");
  });

  it("scrolls to the band a cold deep link named, once the content exists", async () => {
    // The rail can render from the manifest immediately, but the anchor only
    // exists after SectionRenderer mounts -- so the scroll has to wait for it
    // rather than happening once and missing.
    window.location.hash = "#/profile/work-experience";
    mockApi({ packs: packsFixture });
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);

    await waitFor(() => {
      const target = document.querySelector('[data-band="work-experience"]');
      expect(target).not.toBeNull();
      expect(scrollIntoView.mock.instances).toContain(target);
    });
    scrollIntoView.mockRestore();
  });

  it("does not scroll when only a section was chosen", async () => {
    // A section click means "start at the top", which is where the page already
    // is after a section change. Scrolling to nothing in particular would fight
    // that.
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    await user.click(railItem(/Learning Log/));
    await waitFor(() => expect(window.location.hash).toBe("#/learning_log"));
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });
});
