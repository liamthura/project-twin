# Field Patterns (slice 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** land the four editing behaviours the section-editor slice deferred — chip paste that splits on comma and newline, a search box that appears only past six rows, row removal behind an overflow menu, and `headline-3` labels on editable fields.

**Architecture:** Four independent changes to three renderer files plus one new `ui/` component. Nothing here changes list semantics: `useListItems.js` is untouched, and the existing confirmation dialog in `App.jsx` keeps working exactly as it does today. The only structural addition is `src/components/ui/dropdown-menu.jsx`, adapted from the shadcn registry the rest of `ui/` came from.

**Tech Stack:** React 18.2, Tailwind 3 (with `tailwindcss-animate`), plain JSX (no TypeScript), Radix primitives, Vitest + Testing Library + `userEvent`, shadcn-style components in `src/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-12-field-patterns-design.md`

## Global Constraints

- **Plain JSX only.** No TypeScript anywhere in `frontend/src`. The shadcn registry's current output is TS — strip the types when adapting.
- **React 18.2 and Tailwind 3.** The registry targets React 19 and Tailwind 4. Do not copy `data-slot` attributes, Tailwind 4 `@theme` syntax, or React 19-only APIs.
- **Adapt registry components, never hand-roll them.** A menu owes focus trapping, arrow-key navigation, typeahead, Escape, click-outside and `aria-*` wiring.
- **`useListItems.js` must not change.** Its two confirmation tests must pass untouched at the end of every task — they are the proof that this slice left list semantics alone.
- **The confirmation dialog stays.** `App.jsx:176-197` and `:784-799`, and `removeItem`'s `onShowConfirmation` route, are all out of bounds. Its copy, `"Remove <title>?"` and `"This can't be undone."`, does not change.
- **No existing behavioural assertion may be weakened or deleted.** Task 2 rewrites the *interaction path* of nine test call sites and the *row anchor* of three more; every `expect` in all twelve survives verbatim.
- **The two frozen fixtures are untouched:** `frontend/src/__fixtures__/field-census-v1.json` and `control-census-v1.json`. Neither records a CSS class or a control's DOM position, so nothing here should move them. If either changes, stop.
- **Design tokens only.** `bg-popover`, `text-popover-foreground`, `bg-accent`, `text-destructive` are all defined in `tailwind.config.js:35-49` and `src/globals.css` for both themes. Do not introduce a raw colour.
- Test command: `npx vitest run --project unit` from `frontend/`. Bare `npm test` also runs the storybook project.
- Full green before every commit. **Two counts, and they are not the same number:** `npx vitest run --project unit` starts at **835 passing in 42 files**; bare `npm test` adds the Storybook browser project and starts at **837 in 43**. Every per-task figure below is the UNIT-ONLY count, because that is the command each task runs. (Corrected 2026-08-12: the first draft of this plan quoted the two-project total against the unit-only command, so every expected figure was 2 high.)

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/dropdown-menu.jsx` | **Create.** Four exports wrapping Radix: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`. Nothing else — YAGNI. | 1 |
| `src/components/ui/dropdown-menu.test.jsx` | **Create.** Proves the primitive opens, exposes `menuitem` roles, and closes on select — once, here, so no consumer has to re-prove it. | 1 |
| `package.json` | **Modify.** Add `@radix-ui/react-dropdown-menu`. | 1 |
| `src/renderers/ListRenderer.jsx:604-608` | **Modify.** The `Trash2` button becomes a `⋯` menu holding one destructive `Remove`. | 2 |
| `src/renderers/ListRenderer.test.jsx` | **Modify.** One `removeRow` helper; nine call sites routed through it. Assertions unchanged. | 2 |
| `src/renderers/SectionRenderer.test.jsx` | **Modify.** Three sites use the remove button's label as a per-row DOM anchor, not to remove. Anchor name only. | 2 |
| `src/renderers/realWorldShapes.test.jsx` | **Modify.** Home of the real pin fixture; gains the "pin stays inline" case. | 2 |
| `src/components/ArrayInput.jsx` | **Modify.** Add `onPaste`; `onKeyPress` → `onKeyDown`. | 3 |
| `src/components/ArrayInput.test.jsx` | **Create.** The component has no test file today. | 3 |
| `src/renderers/ListRenderer.jsx:322` | **Modify.** Search threshold. | 4 |
| `src/globals.css` | **Modify.** Define `.headline-3` once, in a new `@layer components`. | 5 |
| `src/renderers/FieldsRenderer.jsx:72` | **Modify.** Label to `headline-3`. | 5 |
| `src/renderers/ListRenderer.jsx:639` | **Modify.** Expanded-row editable label to `headline-3`. `:626` stays muted. | 5 |
| `src/renderers/SectionRenderer.jsx:362` | **Modify.** Adopt the new class; it was the one inline spelling of the token. | 5 |

Tasks 3, 4 and 5 are independent of each other and of 1–2. Task 2 consumes Task 1.

---

### Task 1: The `DropdownMenu` primitive

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/ui/dropdown-menu.jsx`
- Test: `frontend/src/components/ui/dropdown-menu.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `DropdownMenu`, `DropdownMenuTrigger` (accepts `asChild`), `DropdownMenuContent` (accepts `align`, `sideOffset`), `DropdownMenuItem` (accepts `variant: "default" | "destructive"`, `onSelect`). Task 2 imports all four from `@/components/ui/dropdown-menu`.

**Why this task exists at all:** there is no dropdown menu in this project. `src/components/ui/` holds 19 components and none is it; `@radix-ui/react-dropdown-menu` is absent from `package.json`, which lists seven other `@radix-ui/*` packages. Both the parent spec and the first draft of the child spec assumed otherwise.

- [ ] **Step 1: Confirm the jsdom polyfills a Radix menu needs are already present**

Radix menus call `hasPointerCapture` and `scrollIntoView`, and observe with `ResizeObserver`. jsdom implements none of them. They were polyfilled for Radix's Select already.

Run: `grep -n "hasPointerCapture\|scrollIntoView\|ResizeObserver" frontend/src/test/setup.js`

Expected: hits around lines 58, 86 and 94. If any is missing, add it there in the same style **before** continuing, because every test in this task and Task 2 depends on it.

- [ ] **Step 2: Install the dependency**

```bash
cd frontend && npm install @radix-ui/react-dropdown-menu
```

Expected: `package.json` gains the dependency and `package-lock.json` updates. Check the resolved version supports React 18 — its `peerDependencies` must include `^18`.

- [ ] **Step 3: Write the failing test**

Create `frontend/src/components/ui/dropdown-menu.test.jsx`:

```jsx
// The menu primitive, proved once here so no consumer has to re-prove it.
//
// Radix supplies the focus trap, arrow-key navigation, typeahead and aria
// wiring; these tests do not re-test Radix. They pin the three facts every
// caller relies on: the content is absent until the trigger is used, the items
// are reachable by the `menuitem` role, and selecting one closes the menu.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function Menu({ onSelect = () => {} }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions">⋯</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onSelect}>
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("does not render its items until the trigger is used", () => {
    render(<Menu />);
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("exposes its items as menuitem roles once open", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("calls onSelect and closes when an item is chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  // `text-destructive` is a real design token (tailwind.config.js:35), so this
  // asserts the token by name -- not the same thing as restating a multi-class
  // incantation, which is why Task 5 defines `headline-3` instead of asserting
  // its three classes here.
  it("marks a destructive item with the destructive token", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = await screen.findByRole("menuitem", { name: "Remove" });
    expect(item.className).toMatch(/text-destructive/);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/components/ui/dropdown-menu.test.jsx`

Expected: FAIL — `Failed to resolve import "./dropdown-menu"`.

- [ ] **Step 5: Write the component**

Create `frontend/src/components/ui/dropdown-menu.jsx`:

```jsx
import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"

import { cn } from "@/lib/utils"

// Adapted from the shadcn registry, trimmed to the four exports this app uses.
// The registry ships a dozen more (CheckboxItem, RadioGroup, Sub, Shortcut...);
// none has a caller here, and an unused export is a thing to maintain and a
// thing to get wrong. Add one when something needs it.
//
// Adapted rather than copied: the registry's current output targets React 19,
// Tailwind 4 and TypeScript, and this project is React 18.2, Tailwind 3 and
// plain JSX. So no `data-slot` attributes and no type annotations. The
// animation utilities come from `tailwindcss-animate`, which tailwind.config.js
// already loads.

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuContent = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) => (
    // Portalled, so the content is NOT a DOM descendant of the trigger. That is
    // what stops a click inside the menu from bubbling into a row's own
    // onClick -- see ListRenderer, where the row header toggles `expanded`.
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
)
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef(
  ({ className, variant = "default", ...props }, ref) => (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        // A destructive item is named by colour AND by its label. Colour alone
        // is not an accessible signal.
        variant === "destructive" &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive",
        className
      )}
      {...props}
    />
  )
)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd frontend && npx vitest run --project unit src/components/ui/dropdown-menu.test.jsx`

Expected: PASS, 4 tests.

If the open tests hang or throw from inside Radix, revisit Step 1 — a missing `hasPointerCapture` throws from Radix's own pointer handling and the message does not name the polyfill.

- [ ] **Step 7: Full suite, then commit**

Run: `cd frontend && npx vitest run --project unit`

Expected: **839 passing** (835 + 4), 43 files.

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/components/ui/dropdown-menu.jsx \
        frontend/src/components/ui/dropdown-menu.test.jsx
git commit -m "feat(ui): a dropdown menu primitive, adapted from the registry

Four exports over @radix-ui/react-dropdown-menu -- Root, Trigger, Content, Item
-- and not the dozen more the registry ships, because nothing here calls them.

Adapted rather than copied: the registry targets React 19, Tailwind 4 and
TypeScript; this is React 18.2, Tailwind 3 and plain JSX. Content is portalled,
which is what keeps a click inside the menu from bubbling into a list row's own
expand handler.

The jsdom polyfills a Radix menu needs (hasPointerCapture, scrollIntoView,
ResizeObserver) were already in src/test/setup.js for Radix's Select.

839 frontend unit tests pass (835 + 4)."
```

---

### Task 2: Remove moves behind an overflow menu

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx:604-608` (and its `lucide-react` import at `:31`)
- Test: `frontend/src/renderers/ListRenderer.test.jsx` (nine call sites, one new helper, two new cases)
- Test: `frontend/src/renderers/SectionRenderer.test.jsx` (three row anchors)
- Test: `frontend/src/renderers/realWorldShapes.test.jsx` (one new case, on the real pin fixture)

**Interfaces:**
- Consumes: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from Task 1.
- Produces: a per-row trigger whose accessible name is `More actions for <title>`, and a menu item whose accessible name is `Remove`. Nothing later in this plan depends on it.

**The behaviour that must not change:** `removeItem(idx)` still routes through `onShowConfirmation`, which still raises the dialog with `"Remove <title>?"` and `"This can't be undone."`, and `onItems` is still not called until the confirm callback runs.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/renderers/ListRenderer.test.jsx`. Put the helper next to the existing `describe` blocks so all nine sites can reach it:

```jsx
// Removal is two interactions now: open the row's overflow menu, then choose
// Remove. Every call site below went through this helper rather than repeating
// the pair, because there are nine of them and they all mean the same thing.
//
// The trigger is identified per row ("More actions for Scandinavian") and the
// item is not ("Remove"), which is deliberate: only one menu is open at a time,
// so the row is already established by the click that opened it.
async function removeRow(user, title) {
  await user.click(
    screen.getByRole("button", { name: `More actions for ${title}` })
  );
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
}
```

Then add three new cases:

```jsx
  it("keeps Remove out of the row body until the overflow menu is opened", () => {
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={vi.fn()} />
    );
    // The row offers a way IN to the destructive action, but not the action.
    expect(
      screen.getByRole("button", { name: "More actions for Scandinavian" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("marks the Remove item destructive", async () => {
    const user = userEvent.setup();
    render(
      <ListRenderer node={node} entity={entity} items={[scandinavian]} onItems={vi.fn()} />
    );
    await user.click(
      screen.getByRole("button", { name: "More actions for Scandinavian" })
    );
    const item = await screen.findByRole("menuitem", { name: "Remove" });
    expect(item.className).toMatch(/text-destructive/);
  });

```

**The pin case goes in a different file.** `ListRenderer.test.jsx` has no pinned
fixture — the pin tests live in `realWorldShapes.test.jsx`, which drives the real
`aesthetics` pack (`primary` is its `show: ["pin"]` field) through
`renderSection`. Add this beside the existing pin block there, around `:233`:

```jsx
    it("leaves the pin star inline rather than moving it into the menu", async () => {
      const { user } = renderSection({ pack: aestheticsPack, initial: styles });
      // Positive, idempotent, one click. Only the destructive action moved.
      expect(
        screen.getByRole("button", { name: "Make Brutalist primary" })
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "More actions for Brutalist" })
      );
      expect(screen.queryByRole("menuitem", { name: /primary/i })).toBeNull();
    });
```

`aestheticsPack` is defined at `realWorldShapes.test.jsx:28` and `styles` at
`:216`; `renderSection` comes from `src/test/harness.jsx`. Use them rather than
declaring anything new.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`

Expected: the three new tests FAIL — no button named `More actions for Scandinavian` exists yet. The nine existing sites still PASS, because the `Remove Scandinavian` button is still there. Both halves matter: this is the point at which old and new coexist.

- [ ] **Step 3: Change the component**

In `frontend/src/renderers/ListRenderer.jsx`, replace the import at `:31`:

```jsx
import { Plus, Trash2, ChevronDown, Star, MoreHorizontal } from "lucide-react";
```

and replace lines 604-608 in full:

```jsx
                <DropdownMenu>
                  {/* stopPropagation because this trigger sits INSIDE the row
                      header, whose own onClick toggles `expanded` -- opening a
                      menu must not also expand the row. The menu content needs
                      no such guard: it is portalled out of this subtree. */}
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      aria-label={`More actions for ${item[titleField] || "Untitled entry"}`}
                      onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
```

Add the import beside the other `@/components/ui` imports at the top of the file:

```jsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

`removeItem` is already in scope from the `useListItems` destructure at `:189`. Do not change that call.

- [ ] **Step 4: Run and watch the three new tests pass and twelve old ones fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`

Expected: the 3 new tests PASS. Twelve tests now FAIL with `Unable to find an accessible element with the role "button" and name "Remove <title>"` — nine in `ListRenderer.test.jsx` (`:164`, `:387`, `:434`, `:451`, `:581`, `:752`, `:753`, `:1075`, `:1363`) and three in `SectionRenderer.test.jsx` (`:1091`, `:1888`, `:2316`).

Run the whole project to see all twelve: `npx vitest run --project unit`.

**The two groups need different fixes, and the difference matters.** The nine click the button to remove a row. The three never remove anything — they use the button's accessible name as the only unique per-row handle in the markup, then walk up to the row element and scope `within(row)` queries to it. `SectionRenderer.test.jsx:1091` says so outright: the row has no title text, so "it is reachable only through the remove button's generated label". Step 5 handles the nine; Step 6 handles the three.

`StringsRenderer.test.jsx:117` also matches `name: "Remove …"` and must **not** change. Its `Remove highlight 2` comes from `StringsRenderer.jsx:82`, a different component removing a bare string from an array. Nothing in this task touches it. If it fails, something went wrong.

- [ ] **Step 5: Route the nine call sites through the helper**

At each of the nine lines, replace the two-line get-then-click with one `removeRow` call. For example at `:164`:

```jsx
    // was:
    //   const deleteButton = screen.getByRole("button", { name: "Remove Scandinavian" });
    //   await user.click(deleteButton);
    await removeRow(user, "Scandinavian");
```

and at `:434`, where the row has no title:

```jsx
    await removeRow(user, "Untitled entry");
```

Rules for this step:

1. **Change only the path to the control.** Every `expect` in those nine tests stays byte-identical, including the two that assert `"Remove Scandinavian?"` and `"This can't be undone."`.
2. The comment at `:161-163` explains selecting the delete button by accessible name because it is icon-only. Rewrite it to describe the menu, do not delete it.
3. Two sites (`:752`, `:753`) remove two rows in succession. Each `removeRow` opens a fresh menu, so they stay two calls; do not try to batch them.
4. If a site does not have a `user` in scope, it was using `fireEvent` — give it `const user = userEvent.setup();` rather than making the helper accept `fireEvent`.

- [ ] **Step 6: Re-point the three row anchors in `SectionRenderer.test.jsx`**

These three do not remove anything. They need the *new* trigger's name as their anchor, and nothing else:

```jsx
// :1091 -- the row has no title text, so the trigger's generated label is still
// the only unique handle it has.
const row = screen.getByRole("button", { name: "More actions for Untitled entry" })
  .parentElement;

// :1888
const row = screen
  .getByRole("button", { name: "More actions for worked examples" })
  .closest("div").parentElement;

// :2316
const row = screen.getByRole("button", { name: "More actions for Welsh" })
  .closest("div").parentElement;
```

**The DOM traversal does not change**, and that is because of `asChild`. `DropdownMenuTrigger asChild` makes Radix clone the `Button` and merge its props onto it rather than wrapping it in an element of its own, so the button stays the same child of the same parent at the same depth. `.parentElement` and `.closest("div").parentElement` keep resolving to the row they resolved to before.

If either traversal starts landing somewhere else, `asChild` was dropped from the trigger. Fix the component, not the test.

Update each site's comment to say "the trigger's accessible name" rather than "the remove button's". The reason each comment gives — that this is the one per-row unique handle — is still true and still worth stating.

- [ ] **Step 7: Run the file, then the full suite**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`

Expected: `ListRenderer.test.jsx` PASS with 2 more tests than before, and `SectionRenderer.test.jsx` and `realWorldShapes.test.jsx` both PASS (the latter with 1 more).

Run: `cd frontend && npx vitest run --project unit`

Expected: **842 passing** (839 + 3: two in `ListRenderer.test.jsx`, one in `realWorldShapes.test.jsx`), 43 files. In particular `useListItems.test.jsx` must be untouched and green — it is the evidence that list semantics did not move.

- [ ] **Step 8: Verify the fixtures did not move**

Run: `git status --short frontend/src/__fixtures__/`

Expected: no output. A change to `field-census-v1.json` or `control-census-v1.json` here would mean something other than a DOM position changed; stop and find out what.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx \
        frontend/src/renderers/SectionRenderer.test.jsx \
        frontend/src/renderers/realWorldShapes.test.jsx
git commit -m "feat(editor): row removal moves behind an overflow menu

The bare Trash2 in the row header becomes a ⋯ menu holding one destructive
Remove. Destructive actions do not belong one stray click from a row body.

The confirmation dialog is untouched and still fires: Remove calls the same
removeItem(idx), which still routes through onShowConfirmation with
\"Remove <title>?\" / \"This can't be undone.\" useListItems does not change at
all, and its two confirmation tests pass untouched -- that is the evidence this
did not disturb list semantics.

The trigger is named per row (More actions for <title>); the item is not, since
only one menu is open at a time and the row is established by the click that
opened it. The pin star stays inline: it is positive and idempotent, and only
the destructive action moved.

Nine test call sites reached the old button directly by accessible name. Behind
a menu that control does not exist until the trigger opens, and a Radix item is
a menuitem rather than a button, so all nine now go through one removeRow
helper. Every assertion in them is unchanged.

842 frontend unit tests pass."
```

---

### Task 3: Chip paste splits on comma and newline

**Files:**
- Modify: `frontend/src/components/ArrayInput.jsx`
- Test: `frontend/src/components/ArrayInput.test.jsx` (create — the component has none)

**Interfaces:**
- Consumes: nothing.
- Produces: no new exports. `ArrayInput`'s props are unchanged (`items`, `onChange`, `placeholder`).

**Today:** pasting `"React, Vue, Svelte"` and pressing Enter creates one chip called `React, Vue, Svelte`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ArrayInput.test.jsx`:

```jsx
// ArrayInput had no tests. It backs every `strings` field in the editor and the
// `type: "strings"` branch of ScalarField, so these also pin the Enter
// behaviour that already worked -- the onPaste change sits in the same handler
// area and Enter is what would break silently.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ArrayInput } from "./ArrayInput";

function setup(items = []) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ArrayInput items={items} onChange={onChange} placeholder="Add one…" />);
  return { onChange, user, input: screen.getByPlaceholderText("Add one…") };
}

describe("ArrayInput paste", () => {
  it("splits a comma-delimited paste into one chip per value", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue, Svelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("splits on newlines too", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React\nVue\nSvelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("handles both delimiters in one paste", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue\nSvelte");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Svelte"]);
  });

  it("appends to the existing items rather than replacing them", async () => {
    const { onChange, user, input } = setup(["Angular"]);
    await user.click(input);
    await user.paste("React, Vue");
    expect(onChange).toHaveBeenCalledWith(["Angular", "React", "Vue"]);
  });

  it("drops empty and whitespace-only pieces", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, , ,\n  \nVue,");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
  });

  it("commits every piece and clears the input, delimiter at the end or not", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue, Sve");
    // No special case for the final piece: a delimited paste is a list, and
    // withholding its last value only put an extra Enter in the way.
    expect(onChange).toHaveBeenCalledWith(["React", "Vue", "Sve"]);
    expect(input).toHaveValue("");
  });

  it("keeps text already typed, as its own value ahead of the pasted ones", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "Angular");
    await user.paste("React, Vue");
    // The input is cleared on a delimited paste, so "Angular" has to go
    // somewhere or it is silently lost.
    expect(onChange).toHaveBeenCalledWith(["Angular", "React", "Vue"]);
    expect(input).toHaveValue("");
  });

  it("leaves the input empty when the paste ends in a delimiter", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React, Vue,");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
    expect(input).toHaveValue("");
  });

  it("commits nothing for a paste with no delimiter, and fills the input", async () => {
    const { onChange, user, input } = setup();
    await user.click(input);
    await user.paste("React");
    // Pasting a fragment must stay editable. Committing it would make the
    // input unusable for anyone assembling a value from two sources.
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("React");
  });

  it("accepts a duplicate, exactly as Enter does", async () => {
    const { onChange, user, input } = setup(["React"]);
    await user.click(input);
    await user.paste("React, Vue");
    // No dedupe on either entry route. Adding it to one and not the other is
    // how the two would come to disagree.
    expect(onChange).toHaveBeenCalledWith(["React", "React", "Vue"]);
  });
});

describe("ArrayInput typing", () => {
  it("still commits on Enter after the onKeyDown swap", async () => {
    const { onChange, user, input } = setup(["React"]);
    await user.type(input, "Vue{Enter}");
    expect(onChange).toHaveBeenCalledWith(["React", "Vue"]);
    expect(input).toHaveValue("");
  });

  it("ignores Enter on an empty input", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("trims a typed value", async () => {
    const { onChange, user, input } = setup();
    await user.type(input, "  React  {Enter}");
    expect(onChange).toHaveBeenCalledWith(["React"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd frontend && npx vitest run --project unit src/components/ArrayInput.test.jsx`

Expected: the three "ArrayInput typing" tests PASS (that behaviour exists). The nine paste tests FAIL — the pasted text lands in the input as one string, so `onChange` is never called.

- [ ] **Step 3: Implement**

In `frontend/src/components/ArrayInput.jsx`, add the handler after `removeItem`:

```jsx
  // A paste that carries a delimiter is a LIST of values; one that does not is
  // a value the user is still writing. Splitting only the first kind is what
  // keeps the input usable for assembling a value from two sources -- paste
  // "Sve", type "lte".
  //
  // Every piece is committed and the input is cleared. Withholding the last one
  // unless the paste ended on a delimiter was the first design, and it is
  // inconsistent about identical input -- "React, Vue, Svelte" and
  // "React, Vue, Sve" are both three pieces with no trailing delimiter. It also
  // penalised the common case, pasting a finished list, with an extra Enter.
  // Owner ruling, 2026-08-12. `DELIMITED` lives at module scope, above the
  // component: no `g` flag, so `.test()` carries no lastIndex between calls.
  //
  // No dedupe: addItem does not dedupe on Enter, and doing it on one route only
  // is how the two would come to disagree. See the spec's §1.
  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text");
    if (!DELIMITED.test(text)) return;   // fall through to the normal paste
    e.preventDefault();

    const pieces = text.split(DELIMITED).map((s) => s.trim()).filter(Boolean);
    // Anything already typed becomes the first value rather than being
    // discarded: the input is about to be cleared, so leaving it out would
    // silently lose it.
    const lead = newItem.trim();
    const additions = lead ? [lead, ...pieces] : pieces;

    if (additions.length > 0) onChange([...items, ...additions]);
    setNewItem("");
  };
```

Then wire it, and swap the deprecated handler:

```jsx
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), addItem())
          }
          placeholder={placeholder}
          className="flex-1"
        />
```

`onKeyPress` is deprecated in React 18 and this is the handler the paste work sits beside, so it changes here rather than in a drive-by commit of its own.

`DELIMITED` is a literal with no `g` flag, so `.test()` carries no `lastIndex` state between calls. Declare it at module scope, above the component, rather than inside it.

- [ ] **Step 4: Run and watch everything pass**

Run: `cd frontend && npx vitest run --project unit src/components/ArrayInput.test.jsx`

Expected: PASS, 13 tests.

- [ ] **Step 5: Full suite**

Run: `cd frontend && npx vitest run --project unit`

Expected: **855 passing** (842 + 13), 44 files.

`ArrayInput` backs every `strings` field and `ScalarField`'s `strings` branch, so watch `StringsRenderer.test.jsx`, `ScalarField.test.jsx` and `controlCensus.render.test.jsx` in particular. A failure there means the `onKeyDown` swap changed Enter's behaviour.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ArrayInput.jsx frontend/src/components/ArrayInput.test.jsx
git commit -m "feat(editor): pasting a list into a chip input makes chips

Pasting \"React, Vue, Svelte\" made one chip called \"React, Vue, Svelte\".
onPaste now splits on comma and newline.

Two rules decide whether this feels right. A paste with NO delimiter falls
through to the browser's paste and commits nothing, because someone pasting
\"React\" may be pasting a fragment they intend to finish. And a paste that does
not end on a delimiter leaves its last piece in the input, so \"React, Vue,
Sve\" gives two chips and leaves \"Sve\" to complete.

Anything already typed leads the first pasted value, so pasting into a
half-written entry does not drop it.

No dedupe. addItem does not dedupe on Enter either, and adding it to one route
and not the other is how the two would come to disagree -- if duplicate chips
are worth preventing that is one decision for both paths.

onKeyPress becomes onKeyDown: deprecated in React 18, and it is the handler this
change sits beside.

ArrayInput had no test file. It has 12 now, three of which pin the Enter
behaviour that already worked, because that is what the handler swap could
break silently.

855 frontend unit tests pass."
```

---

### Task 4: The search box appears only past six rows

**Files:**
- Modify: `frontend/src/renderers/ListRenderer.jsx:322`
- Test: `frontend/src/renderers/ListRenderer.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: no new exports.

**Today:** `node.search && (items.length > 0 || q)`. A two-row list gets a filter box.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/renderers/ListRenderer.test.jsx`:

```jsx
  // "Past six" is seven or more. At six and below the box is chrome with
  // nothing to do.
  const sixRows = Array.from({ length: 6 }, (_, i) => ({ name: `Row ${i + 1}` }));
  const sevenRows = Array.from({ length: 7 }, (_, i) => ({ name: `Row ${i + 1}` }));

  it("hides the search box at six rows", () => {
    render(
      <ListRenderer node={{ ...node, search: true }} entity={entity}
        items={sixRows} onItems={vi.fn()} />
    );
    expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
  });

  it("shows the search box at seven rows", () => {
    render(
      <ListRenderer node={{ ...node, search: true }} entity={entity}
        items={sevenRows} onItems={vi.fn()} />
    );
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("keeps the box mounted while a query is active even below the threshold", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ListRenderer node={{ ...node, search: true }} entity={entity}
        items={sevenRows} onItems={vi.fn()} />
    );
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "Row 1");
    // Falling to six with a live query must not unmount the only control that
    // can clear it -- otherwise the user is stranded on a filtered list.
    rerender(
      <ListRenderer node={{ ...node, search: true }} entity={entity}
        items={sixRows} onItems={vi.fn()} />
    );
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("never shows a box for a node that does not declare search, at any count", () => {
    render(
      <ListRenderer node={{ ...node, search: false }} entity={entity}
        items={sevenRows} onItems={vi.fn()} />
    );
    expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
  });
```

If `role="searchbox"` does not resolve (the input is `type="search"`, which maps to that role), fall back to `screen.queryByLabelText("Search")` consistently across all four.

- [ ] **Step 2: Run them and watch the right ones fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`

Expected: "hides at six rows" FAILS (the box renders today at any count ≥1). The other three PASS already. Only the first is the behaviour change; the other three are guards on what must keep working.

- [ ] **Step 3: Change the condition**

In `frontend/src/renderers/ListRenderer.jsx`, at `:322`, change:

```jsx
      {node.search && (items.length > 0 || q) && (
```

to:

```jsx
      {node.search && (items.length > 6 || q) && (
```

And extend the comment above it, which already explains the `|| q` half:

```jsx
      {/* Six rows or fewer need no filter: the box is chrome with nothing to
          do, and the eye beats it. Counts TOTAL items, not filtered ones, so
          the box does not vanish from under the cursor as a query narrows the
          list past the threshold.

          Keep the box mounted whenever a query is active, even if it filtered
          every row out of existence -- otherwise deleting the last match(es)
          unmounts the only control that can clear `query`, stranding the user
          on an empty state that tells them to "clear the search" with nothing
          left to clear it with. The threshold makes that reachable a second
          way: delete a seventh row while a query is live. */}
```

- [ ] **Step 4: Run and watch all four pass**

Run: `cd frontend && npx vitest run --project unit src/renderers/ListRenderer.test.jsx`

Expected: PASS.

Any OTHER test in this file that fails here is a test whose fixture has 1-6 rows and which reaches for the search box. That is a real consequence of the change, not a flaw in it: give that test seven rows if it is about searching, or drop its search interaction if it is not. Note each such edit in the commit message.

- [ ] **Step 5: Full suite, then commit**

Run: `cd frontend && npx vitest run --project unit`

Expected: **859 passing** (855 + 4).

```bash
git add frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/ListRenderer.test.jsx
git commit -m "feat(editor): the search box appears only past six rows

A two-row list had a filter box. Six or fewer needs none -- the eye beats it,
and the box was chrome with nothing to do.

Counts total items rather than filtered ones, so the box does not vanish from
under the cursor as a query narrows the list. The existing '|| q' escape is
kept and matters more than it did: a live query always shows the box, so
falling from seven rows to six mid-search cannot strand anyone on a filtered
list with no way to clear it.

Facets are untouched. They are declared per node and shown independently.

859 frontend unit tests pass."
```

---

### Task 5: `headline-3` becomes a real class, and editable labels use it

**Files:**
- Modify: `frontend/src/globals.css`
- Modify: `frontend/src/renderers/FieldsRenderer.jsx:72`
- Modify: `frontend/src/renderers/ListRenderer.jsx:639`
- Modify: `frontend/src/renderers/SectionRenderer.jsx:362`
- Test: `frontend/src/renderers/FieldsRenderer.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a `headline-3` CSS class, available to any component.

**Ruled by the owner, 2026-08-12.** The first draft of this task changed three
Tailwind classes at each site and asserted all three in the test. Defining the
token once as a real class and asserting that one name is less brittle and says
what it means. It does widen the slice into the token layer, which the spec did
not ask for, and that was the trade accepted.

`headline-3` is 14/600 — `text-sm font-semibold text-foreground`. The name comes
from the design specs; before this task it appeared nowhere in the code except a
comment at `SectionRenderer.jsx:355`.

**There is no asymmetry to worry about.** The sibling tokens (`featured-3`,
`headline-2`, `caption-1`, `caption-2`) appear nowhere in `frontend/src` at all —
not as classes, not as comments. So this is the first token utility rather than
the odd one out, and the others stay in the specs until something needs them.
Do not define them here.

**`SectionRenderer.jsx:362` must adopt it too.** It is the one place that already
spells `text-sm font-semibold text-foreground` inline. Defining a utility and
leaving that site as-is would put two spellings of one token in the codebase,
which is the exact defect the manifest migration spent twelve tasks removing. No
test asserts those classes (checked), so adopting it is safe.

**`ListRenderer.jsx:626` is deliberately excluded.** Those are `bodyDisplayFields`
(`:505`), the fields claiming the `row` position, drawn as a label above a mono
`<p>`. That is a readout, not a control, so its label annotates a value rather
than labelling an input. The exclusion rests on that rendering, not on who writes
the field: in today's packs all four `row`-position fields happen to be `ui_only`
server-written timestamps, which is an observation and not the rule.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/renderers/FieldsRenderer.test.jsx`:

```jsx
  // The parent spec's complaint was that `text-xs text-muted-foreground` reads
  // as helper text rather than as a label. `headline-3` is the design specs'
  // name for 14/600, and globals.css is where it is defined -- so this asserts
  // the token by name rather than restating its three Tailwind classes here.
  it("draws an editable field's label at headline-3", () => {
    renderFields();
    const label = screen.getByText("Tone");
    expect(label.className).toContain("headline-3");
    expect(label.className).not.toContain("text-muted-foreground");
  });
```

`renderFields` is the file's own helper at `FieldsRenderer.test.jsx:29`, and
`Tone` is the title-cased label of the `tone` descriptor its `node` declares at
`:15` — the same label `:38`'s existing test queries. Nothing new to declare.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run --project unit src/renderers/FieldsRenderer.test.jsx`

Expected: FAIL — the class is `text-xs text-muted-foreground`.

- [ ] **Step 3: Define the token**

`frontend/src/globals.css` has `@layer base` blocks at `:14` and `:117` and no
`@layer components`. Add one after the `@layer base` block that ends around
`:150`, before the reduced-motion section:

```css
/* The design specs name a small typographic scale -- featured-3, headline-2,
   headline-3, caption-1, caption-2 -- and until now none of it existed in the
   code except as Tailwind classes spelled out at each site, with a comment
   naming the token if you were lucky.
   
   `headline-3` is defined here because three call sites need it and a label's
   weight is the whole point of the change, so it needs a name a test can assert
   and a reader can find. The other four are not defined: nothing uses them yet,
   and an unused class is a thing to maintain and to get wrong.
   
   In `components` rather than `utilities` so a one-off `text-base` on a call
   site still wins. */
@layer components {
  .headline-3 {
    @apply text-sm font-semibold text-foreground;
  }
}
```

Write the class as a literal string at every call site. Tailwind's content
scanner reads the JSX to decide what to keep, so a dynamically assembled name
(`` `headline-${n}` ``) would be purged from the production build and pass every
jsdom test, which asserts strings and never loads CSS.

- [ ] **Step 4: Use it at all three sites**

`frontend/src/renderers/FieldsRenderer.jsx:72`:

```jsx
            <Label htmlFor={id} className="headline-3">
```

`frontend/src/renderers/ListRenderer.jsx:639`:

```jsx
                      <Label className="headline-3">
```

`frontend/src/renderers/SectionRenderer.jsx:362` — the site that already spelled
the token inline:

```jsx
      <Heading className="headline-3">{title}</Heading>
```

`capitalize` goes with the class it sat in at the two renderer label sites. Both
already resolve their text through `meta.field_labels[f] ?? f.replace(/_/g, " ")`,
and `FieldsRenderer`'s own `labelFor` title-cases in JS precisely so the label is
not CSS-capitalised — keeping a CSS capitalise on one site and not the other is
how the two came to differ.

Update the comment at `SectionRenderer.jsx:355`, which currently names the token
in prose because it had nowhere else to live. It can now point at the class.

**Do not touch `ListRenderer.jsx:626.`** Leave its `text-xs capitalize` exactly
as it is.

- [ ] **Step 5: Run and watch it pass**

Run: `cd frontend && npx vitest run --project unit src/renderers/FieldsRenderer.test.jsx`

Expected: PASS.

- [ ] **Step 6: Confirm the readout labels did not move**

Run: `git diff frontend/src/renderers/ListRenderer.jsx | grep "text-xs capitalize"`

Expected: no `-` line removing it. `:626` must survive untouched.

- [ ] **Step 7: Confirm the token has exactly one definition**

Run: `grep -rn "text-sm font-semibold text-foreground" frontend/src/`

Expected: exactly one hit, in `globals.css`. Any hit in a `.jsx` file is a second
spelling of the token and defeats the point of this task.

- [ ] **Step 8: Full suite, the build, and the fixtures**

Run: `cd frontend && npx vitest run --project unit`

Expected: **860 passing** (859 + 1), all files.

Run: `cd frontend && npm run build`

Expected: succeeds. This is the step that catches an `@apply` of a class Tailwind
cannot resolve — jsdom tests never load CSS, so a broken `@layer components`
block passes every test and ships a label with no styling.

Run: `git status --short frontend/src/__fixtures__/`

Expected: no output. Neither frozen census records a CSS class.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/globals.css frontend/src/renderers/FieldsRenderer.jsx \
        frontend/src/renderers/ListRenderer.jsx frontend/src/renderers/SectionRenderer.jsx \
        frontend/src/renderers/FieldsRenderer.test.jsx
git commit -m "fix(editor): headline-3 becomes a real class, and labels use it

text-xs text-muted-foreground reads as helper text, not as a label. Both sites
that label an editable control now carry headline-3.

The token got a definition rather than three more inline classes. The design
specs name a small scale -- featured-3, headline-2, headline-3, caption-1,
caption-2 -- and none of it existed in the code except as Tailwind classes
spelled out per site. headline-3 has three call sites and a test that needs to
assert it, so it is defined once in globals.css. The other four are not:
nothing uses them, and an unused class is a thing to get wrong.

SectionRenderer:362 adopts it too. It was the one place already spelling
text-sm font-semibold text-foreground inline, and defining a utility while
leaving it there would put two spellings of one token in the tree -- the exact
defect the manifest migration spent twelve tasks removing. A grep for the
inline form now returns exactly one hit, in globals.css.

Both label sites, not just the one the parent spec named: the same field
rendered a strong label in a fields card and a faint one in an expanded list
row, and the complaint applies equally to each.

ListRenderer:626 is left alone. Those are the row-position fields, drawn as a
label above a mono readout rather than as a control, so the label annotates a
value instead of labelling an input. The exclusion is about that rendering, not
about who writes the field -- all four row-position fields in the shipped packs
happen to be ui_only server-written timestamps, which is an observation and not
the rule.

860 frontend unit tests pass, and npm run build succeeds -- the check that matters
for a CSS change, since jsdom never loads a stylesheet."
```

## Verification, end of slice

- [ ] **Step 1:** `cd frontend && npx vitest run --project unit` → **860 passing** in 44 files, no skips.
- [ ] **Step 2:** `cd frontend && npm test` → both projects green, including the storybook project the unit runs skip.
- [ ] **Step 3:** `git status --short frontend/src/__fixtures__/` → empty. Neither frozen census moved.
- [ ] **Step 4:** `cd backend && python3 -m pytest -q` → **1001 passed, 1 skipped**. Nothing here touches the backend, so a failure means something unrelated leaked in.
- [ ] **Step 5:** `git diff --stat main...HEAD -- frontend/src/renderers/useListItems.js` → empty output. The Global Constraint says this file does not change; this is the check.
- [ ] **Step 6:** `cd frontend && npm run build` → succeeds, and `grep -rn "text-sm font-semibold text-foreground" frontend/src/` returns exactly one hit, in `globals.css`. A CSS change is invisible to jsdom, so the build is the only automated check that `@layer components` resolves.
- [ ] **Step 7:** Rebuild the preview and drive all four by hand — `./scripts/local-preview.sh`, then at `http://127.0.0.1:8100`: paste `a, b, c` into a chip field; confirm Preferences' Likes & Dislikes (7+ rows) shows a search box and a short list does not; open a row's `⋯` and confirm Remove raises the dialog; and check a `fields` card's labels against an expanded list row's, which should now match. **Owner's step, not claimed by the implementer.**

## Self-review

- **Spec coverage.** §1 chip paste → Task 3. §2 search past six → Task 4. §3 overflow menu → Tasks 1 and 2, with the dependency §3 identified as its own task because it is a `package.json` change a reviewer could reject on its own. §4 labels → Task 5, widened by an owner ruling to define `headline-3` as a real class rather than restating its three Tailwind classes at each site; that pulled in `globals.css` and `SectionRenderer.jsx:362`, the one existing inline spelling. The spec's Testing section maps onto the test steps in each task, including the nine call sites named in Task 2 Step 4. Out-of-scope items appear in no task: no undo, no soft delete, no chip dedupe, no `ScalarField` control changes.
- **The `element.list` trap does not apply here.** Nothing in this slice reads the manifest, so the frozen censuses should not move — which is why two tasks check them explicitly rather than assuming.
- **Type consistency.** `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuItem` are the four names Task 1 exports and the four Task 2 imports. `removeRow(user, title)` is defined once in Task 2 Step 1 and used in Step 5. `handlePaste` and `DELIMITED` are defined and wired within Task 3.
- **Test counts are cumulative and stated per task** (835 → 839 → 842 → 855 → 859 → 860, unit-only). If a task's actual number differs, the difference is the thing to explain before committing — most likely a test elsewhere that reached for the search box with fewer than seven rows (Task 4 Step 4 anticipates exactly that).
- **The riskiest task is 2**, not because the component change is hard but because twelve existing tests move — nine change their interaction path and three change the anchor they locate a row by. The rules that keep it honest are in the Global Constraints: every `expect` survives verbatim, and `useListItems.test.jsx` stays untouched and green.
- **The count of affected tests was wrong twice while writing this plan**, which is why Task 2 Step 4 names all twelve line numbers rather than a total. The first pass grepped only `ListRenderer.test.jsx` and found nine; the second found four more across the suite; one of those four (`StringsRenderer.test.jsx:117`) turned out to be a different component removing a bare string, and is called out as a must-not-change so it does not get "fixed" by mistake.
