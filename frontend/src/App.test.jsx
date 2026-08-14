import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import packsFixture from "@/__fixtures__/packs.json";
import circleData from "@/__fixtures__/data/circle.json";
import learningLogData from "@/__fixtures__/data/learning_log.json";

// App.jsx only ever reaches the network through `api`/`getAuthToken`, but it
// also unconditionally renders <SettingsDialog> (just hidden), which
// imports several other named exports (CLOUD_API_URL, getApiBase, ...) from
// this same module. A mock that only replaces api/getAuthToken and drops the
// rest makes React throw the moment that component mounts -- well after
// these tests' own assertions would otherwise have passed -- so this keeps
// every real export and overrides only the ones these tests depend on.
//
// whoami is one of them. The dialog asks the server who you are and shows the
// Account tab only if it answers, so leaving the real one here would have it
// reach for fetch, fail, and decide nobody is signed in -- inside an App that
// has already rendered the signed-in shell, which it only does with a working
// credential. The fixture has to agree with itself.
vi.mock("@/lib/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: vi.fn(),
    getAuthToken: vi.fn(() => "test-token"),
    whoami: vi.fn(async () => ({ user_id: "u-1", username: "Liam" })),
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
    // The test above leaves the hash on #/learning_log, and this one edits a
    // profile field to have something to save -- so it has to say which section
    // it starts in rather than inheriting one.
    window.location.hash = "#/profile";
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(railItem(/Learning Log/)).toBeTruthy());

    // Auto-save is on by default, which leaves the header chip reading "Saved"
    // with no action. The preference moved out of the header in slice 1, so
    // reaching it means opening Connection Settings -- and turning it off does
    // NOT itself save (only the ON transition flushes).
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("switch", { name: "Auto-save" }));
    // Radix marks the rest of the page aria-hidden while a dialog is open, so
    // the header is genuinely unreachable until this closes -- which is correct
    // behaviour, and means the test has to close it like a user would.
    await user.keyboard("{Escape}");
    // Then change something. Save now appears in the "unsaved" state only, and
    // as of slice 2 that state means changes are genuinely pending rather than
    // just "autosave is off" -- so with nothing edited there is nothing to save
    // and no button to press.
    await user.type(screen.getByLabelText("Name"), "Maya");
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

  it("scrolls to a group's band, which is a different element from a leaf's", async () => {
    // The existing cases above use `education`, a top-level leaf whose anchor is
    // its own card. A group's anchor is the wrapper holding its eyebrow label and
    // all of its cards -- a different element produced by a different branch, and
    // the one that would be missed if only leaves were covered.
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);

    await waitFor(() => expect(railItem(/Contact & Links/)).toBeTruthy());
    await user.click(railItem(/Contact & Links/));

    await waitFor(() => {
      const target = document.querySelector('[data-band="contact-links"]');
      expect(target).not.toBeNull();
      expect(target.hasAttribute("data-subsection-card")).toBe(false);
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

// Save feedback, slice 2. The per-flush "Saved" toast is gone: it fired on every
// debounced write, so editing three fields in a row stacked three toasts for
// something the reader never doubted. What replaced it is a tick on the card
// that changed (SectionRenderer's own tests cover that) and a header chip that
// reports what is actually unsaved rather than which preference is set.
describe("App: save feedback", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  const chip = () => document.querySelector("[data-save-state]");

  it("says nothing when an autosave flush succeeds", async () => {
    // Real timers, and a wait long enough to clear the 1500ms autosave debounce.
    // Fake timers would be tidier but userEvent awaits promises the fake clock
    // also owns, and a test that hangs under a faked clock leaves it faked for
    // every test after it.
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    await user.type(screen.getByLabelText("Name"), "M");
    await waitFor(
      () =>
        expect(
          api.mock.calls.some(([e, o]) => e === "/files/profile" && o?.method === "PUT")
        ).toBe(true),
      { timeout: 3000 }
    );

    // The write went out and no toast was raised about it.
    //
    // Two traps in one assertion. It is scoped to the toast viewport because the
    // header chip legitimately reads "Saved", so an unscoped query finds the chip
    // and passes either way. And it looks for that exact word rather than an
    // empty viewport, because shadcn's use-toast keeps its state in MODULE
    // scope: a toast raised by an earlier test in this file is still standing
    // here ("All files saved", from the saveAll test), and RTL's cleanup cannot
    // reach state that never belonged to a component.
    const toasts = document.querySelector("ol");
    expect(toasts).not.toBeNull();
    expect(within(toasts).queryByText("Saved")).not.toBeInTheDocument();
  });

  it("still interrupts when a save fails", async () => {
    mockApi({ packs: packsFixture });
    api.mockImplementation((endpoint, opts) => {
      if (endpoint === "/files/profile" && opts?.method === "PUT") {
        return Promise.reject(new Error("disk full"));
      }
      if (endpoint === "/all") return Promise.resolve({ data: ALL_DATA });
      if (endpoint === "/settings")
        return Promise.resolve({ disabled_sections: [], packs: packsFixture });
      if (endpoint === "/proposals/count")
        return Promise.resolve({ entity: 0, note: 0, total: 0 });
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    await user.type(screen.getByLabelText("Name"), "M");
    // 3s, not findBy's default 1s: the autosave debounce is 1500ms, so a
    // shorter wait would fail before the request had even been made.
    expect(await screen.findByText("Failed to save", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText("disk full")).toBeInTheDocument();
  });

  it("reads Saved with autosave off until something is actually changed", async () => {
    // It used to read "Unsaved" the moment the preference went off, before the
    // reader had touched anything, and to keep reading it after a successful
    // Save now. The chip reports a fact now, not a preference.
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("switch", { name: "Auto-save" }));
    await user.keyboard("{Escape}");

    expect(chip()).toHaveAttribute("data-save-state", "saved");
    expect(screen.queryByRole("button", { name: /save now/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "M");
    expect(chip()).toHaveAttribute("data-save-state", "unsaved");

    await user.click(screen.getByRole("button", { name: /save now/i }));
    await waitFor(() => expect(chip()).toHaveAttribute("data-save-state", "saved"));
  });

  it("keeps the chip honest when the save it offered fails", async () => {
    // Clearing the flag on the attempt rather than on success would leave the
    // page reading "Saved" over changes that never reached the server.
    mockApi({ packs: packsFixture });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("switch", { name: "Auto-save" }));
    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Name"), "M");

    api.mockImplementation((endpoint, opts) => {
      if (endpoint === "/all" && opts?.method === "PUT") return Promise.reject(new Error("nope"));
      if (endpoint === "/all") return Promise.resolve({ data: ALL_DATA });
      if (endpoint === "/settings")
        return Promise.resolve({ disabled_sections: [], packs: packsFixture });
      return Promise.resolve({});
    });
    await user.click(screen.getByRole("button", { name: /save now/i }));

    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
    expect(chip()).toHaveAttribute("data-save-state", "unsaved");
  });
});
