# Field patterns (slice 2b) — design

**Goal:** land the editing behaviours the section-editor slice deferred. Slice 2
restructured the page — eyebrow bands, one card per subsection, the two-tier cap,
the per-card save tick. It deliberately left the patterns that change how a field
*behaves*, because they land in `ListRenderer.jsx` (727 lines, 2051 lines of
tests) and `ArrayInput.jsx`, and folding them in would have roughly tripled a
slice that needed to merge.

Parent: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`,
"Field patterns". Deferral recorded at
`docs/superpowers/plans/2026-08-10-section-editor.md:473`.

## The scope is four patterns, not five

The parent spec lists five. One of them is already true.

Numbers in this table are the **parent spec's**, so its five map onto the four
sections below: parent 1 → §1, parent 3 → §2, parent 4 → §3, parent 5 → §4.

| Parent # | Pattern | State when this spec was written |
|---|---|---|
| 1 | Chip paste splits on comma and newline | Not done. `ArrayInput.jsx` handles Enter only. |
| 2 | Row click expands inline to edit | **Already done.** `ListRenderer.jsx:636` renders live `ScalarField`s inside the expanded row. |
| 3 | Search appears only past six items | Not done. Shows whenever the node declares `search` and holds ≥1 item (`:322`). |
| 4 | Remove behind an overflow menu | Not done, and larger than the parent spec assumed. |
| 5 | `fields` labels at `headline-3` | Not done. `FieldsRenderer.jsx:72` is `text-xs text-muted-foreground`. |

Pattern 2's wording was "**Row click expands inline to edit**, replacing today's
separate edit form". That form is already gone — it went during the renderer-kit
waves, before the redesign started. There is no `EditDialog`, `EditForm`,
`editingIdx` or `editIndex` anywhere in `frontend/src/renderers` or
`frontend/src/components`. Nothing to do.

Pattern 4's wording was "Remove sits behind an overflow `DropdownMenu` and
**keeps its confirmation `Modal`**". There is no confirmation to keep.
`ListRenderer.jsx:604` is a bare `Trash2` icon button that calls
`removeItem(idx)` on one click, and no `AlertDialog` or confirm component exists
in the renderers. So the recovery affordance is new work, and choosing which one
was the only real design decision in this slice.

## 1. Chip paste

**File:** `frontend/src/components/ArrayInput.jsx`

An `onPaste` handler splits the pasted text on `/[,\n]/`, trims each piece and
drops empties.

Two rules that are not obvious and that decide whether this feels right:

**A paste with no delimiter falls through to the browser's normal paste.** It
does not commit a chip. Someone pasting `React` may be pasting a fragment they
intend to finish typing, and committing it would make the input unusable for
that. Only a paste that *contains* a delimiter commits anything.

**A paste that does not end in a delimiter leaves its last piece in the input.**
`"React, Vue, Sve"` gives chips `React` and `Vue`, and leaves `Sve` in the input
to finish. This is what tag inputs conventionally do, and it is the difference
between pasting a list and pasting a list you were midway through writing.

**No deduplication.** `addItem` does `onChange([...items, newItem.trim()])` — it
does not dedupe on Enter today. Adding dedupe on the paste path only would make
the two entry routes disagree, and adding it to both is a behaviour change the
parent spec did not ask for. If duplicate chips are worth preventing, that is its
own decision, made once, for both paths.

`onKeyPress` becomes `onKeyDown`. It is deprecated in React 18 (the project is on
18.2) and it is the handler this change sits next to. Adjacent, not unrelated.

## 2. Search past six

**File:** `frontend/src/renderers/ListRenderer.jsx:322`

```
node.search && (items.length > 6 || q)
```

"Past six" means seven or more. Below that the box is chrome with nothing to do.

**It counts total items, not filtered ones**, so the box does not disappear from
under the cursor as a query narrows the list to six.

**`|| q` is preserved deliberately.** The existing condition carries it, and the
comment above it explains why: a user must never face a filtered list with no way
to clear the filter. That case is now reachable in a new way — delete rows until
seven becomes six while a query is active — so the guard matters more than it did,
not less.

**Facets are untouched.** They are declared per node and shown independently of
`search`; a node with `facets` and six items keeps its chips.

## 3. Remove behind an overflow menu, with batched undo

**Files:** `frontend/src/renderers/ListRenderer.jsx`,
`frontend/src/renderers/useListItems.js`

The `Trash2` button at `:604` becomes a `⋯` `DropdownMenu` trigger holding one
destructive `Remove` item. **The pin star stays inline.** It is a positive,
idempotent, one-click action, and burying it would cost a click to buy nothing —
the parent spec's argument is about destructive actions specifically
("Destructive actions do not belong one stray click from a row body").

### Why undo rather than a confirmation modal

Decided 2026-08-12 by the owner, choosing between an overflow menu alone, an
overflow menu plus an `AlertDialog`, and an overflow menu plus an undo toast.

Undo wins on the thing that actually matters: it is the only one of the three
that makes a mistaken delete *recoverable*. A confirmation modal asks you to
predict a mistake before you make one, which people click through, and it costs a
third click on every deliberate delete to do it. Undo costs nothing on the
deliberate path and catches the accidental one.

**This does not contradict slice 2's toast decision.** Slice 2 retired the
per-flush `toast({ title: "Saved" })` because it confirmed something the reader
never doubted. It kept the destructive-failure toast, because a failure needs
interrupting. An undo toast is the same category as the second: a time-limited
affordance for something that happened, offering an action. It is not a
confirmation.

### Batching

Decided 2026-08-12 by the owner, choosing between a single replaceable slot, one
batched toast, and a stack of separate toasts.

Pruning a list means removing several rows in succession, so a single slot would
make every delete but the last unrecoverable at exactly the moment recovery is
most likely to be wanted. A stack of toasts reproduces the visual noise slice 2
removed.

So: one toast, message keyed to depth.

| Removed | Message |
|---|---|
| one row | `Removed Northumbria University` (the row's title field) |
| more | `Removed 3 entries` |

A row with no title field value reads `Removed Untitled entry`, matching the
`aria-label` fallback already at `:605`.

### Where it lives, and the invariant that decides it

**Undo belongs in `useListItems`, not `ListRenderer`.** That hook's header
documents the rule this depends on:

> `expanded` is keyed by ARRAY INDEX, so any operation that changes the length of
> the list has to move those keys with the rows they name. Add prepends and
> shifts up; remove shifts down. Left alone, a key like `{0: true}` silently
> follows the wrong row.

Restoring a row is a length-changing operation, so it owes the same duty. Putting
it anywhere else would separate it from the four operations that already carry
this invariant and from the tests that hold them to it.

### Mechanics

Each remove pushes `{ row, index }` onto an ordered stack, where `row` is the
stored object as it was and `index` is its position in the array *at the moment of
that removal*.

**Undo replays the stack in reverse.** This is the load-bearing detail: a
captured index is only valid in the array state that existed just before its own
removal. Remove index 2, then index 5 of the now-shorter array, and restoring in
capture order lands the second row in the wrong place. Undoing last-first inserts
each row back into exactly the array it came from. Each insert shifts `expanded`
keys up from the insertion point, mirroring the shift-down that `removeItem`
already performs.

**The restored object keeps its `id`.** `persona_store._assign_ids` uses
`setdefault`, so an id that arrives is never rewritten. Undo therefore restores
the same entity, not a copy — search-index entries, staleness advisories and any
nested `parent` lookup keyed on it all survive. This is why undo must splice the
captured object back and **must not** route through `addItem`, which builds a
fresh row and would earn a new id.

The stack clears when the toast dismisses or times out.

### What this deliberately does not solve

The removal has already autosaved by the time the toast is up — autosave debounces
at 1500ms and the toast outlives that. Undo is a second write, not a rollback of
the first. So navigating away or closing the tab inside the undo window loses the
rows.

That is the same outcome as today, with a window added where there was none. A
genuine fix means a server-side soft delete, which is a data-model change and is
out of scope here.

## 4. Labels

`headline-3` is 14/600, written in code as `text-sm font-semibold text-foreground`
(see `SectionRenderer.jsx:362`, where the token is named in a comment). There is
no utility class for it.

| Location | Today | After |
|---|---|---|
| `FieldsRenderer.jsx:72` | `text-xs text-muted-foreground` | `text-sm font-semibold text-foreground` |
| `ListRenderer.jsx:639` — expanded row, editable fields | `text-xs capitalize` | `text-sm font-semibold text-foreground` |
| `ListRenderer.jsx:626` — expanded row, read-only machine-written fields | `text-xs capitalize` | unchanged |

The parent spec names only `FieldsRenderer`, and its reasoning was that
`text-xs text-muted-foreground` "reads as helper text rather than as a label".
That is equally true of the expanded row's editable labels, so restricting the
change there would leave the same field rendering a strong label in a `fields`
card and a faint one in a list row.

The read-only labels are excluded on the same reasoning, read the other way.
`bodyDisplayFields` (`ListRenderer.jsx:505`) are the fields claiming the `row`
position, and the body draws them as a label above a mono `<p>` — a readout, not
a control. That label annotates a value rather than labelling an input, and an
input's visual weight overstates it.

The exclusion rests on that rendering, not on who writes the field. Worth being
precise about, because in today's packs the two coincide and it would be easy to
state the wrong reason: all four `row`-position fields — knowledge's `added_date`
and `last_updated`, learning_log's `timestamp`, projects' `added_date` — are
`ui_only` server-written timestamps. That is an observation about the shipped
manifests, not the rule. A future pack declaring `show: ["row"]` on a
user-editable field still gets a readout in the body, and still gets the muted
label, because the body is not where that field is edited.

Decided 2026-08-12 by the owner.

`capitalize` is dropped along with the class it sits in: both sites already
resolve their text through `meta.field_labels[f] ?? f.replace(/_/g, " ")`, and
`FieldsRenderer`'s `labelFor` title-cases in JS precisely so the label is not
CSS-capitalised. Keeping a CSS capitalise on one site and not the other is how
they came to differ.

## Testing

New tests only. No existing behavioural assertion changes, and no existing test
is edited to make anything pass.

**No test asserts either label class today** (checked across
`src/renderers/*.test.jsx` and `src/components/*.test.jsx`), so §4 forces no test
edits. The two frozen fixtures, `field-census-v1.json` and
`control-census-v1.json`, record field names and control kinds; neither records a
class, so neither moves.

| Area | Cases |
|---|---|
| `ArrayInput` | delimiter-free paste falls through and commits nothing; comma-delimited paste commits chips; newline-delimited likewise; mixed delimiters; trailing delimiter leaves the input empty; no trailing delimiter leaves the last piece in the input; whitespace-only pieces dropped; a duplicate is accepted, matching Enter |
| `ListRenderer` search | hidden at exactly 6, shown at 7; hidden at 6 but shown when a query is active; a node without `search` never shows a box at any count; facets unaffected at 6 |
| `ListRenderer` menu | Remove is behind the `⋯` trigger and not in the row body; the pin star is still inline; the menu item is destructive |
| `useListItems` undo | one remove then undo restores the row at its index with its `id`; **two removes at different indices then undo restores both at their original indices**; `expanded` still names the same rows after a restore; the stack clears on dismiss |

The two-remove case is the one that fails if the replay order is wrong, so it is
the case that has to exist.

## Out of scope

- Server-side soft delete. Named above as the real fix for the navigate-away hole.
- Chip deduplication, on either entry route. Its own decision if it is wanted.
- Undo for chip removal in `ArrayInput`. A chip is one word and cheap to retype;
  a list row is a form.
- The parent spec's per-card empty states and save tick. Both landed in slice 2.
- Anything in `ScalarField`'s control selection. `controlCensus` freezes it, and
  nothing here changes which control a field resolves to.
