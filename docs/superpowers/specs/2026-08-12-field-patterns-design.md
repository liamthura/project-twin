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
| 4 | Remove behind an overflow menu | The menu is not done. The confirmation it refers to **does** exist and stays. |
| 5 | `fields` labels at `headline-3` | Not done. `FieldsRenderer.jsx:72` is `text-xs text-muted-foreground`. |

Pattern 2's wording was "**Row click expands inline to edit**, replacing today's
separate edit form". That form is already gone — it went during the renderer-kit
waves, before the redesign started. There is no `EditDialog`, `EditForm`,
`editingIdx` or `editIndex` anywhere in `frontend/src/renderers` or
`frontend/src/components`. Nothing to do.

Pattern 4's wording was "Remove sits behind an overflow `DropdownMenu` and
**keeps its confirmation `Modal`**". That is correct as written: the modal exists
and this slice keeps it. Only the menu is new.

> **Correction, 2026-08-12.** The first draft of this spec claimed there was no
> confirmation to keep, and a design decision was taken on that basis before the
> claim was checked properly. It is wrong. `App.jsx:176-197` holds the dialog
> state and `showConfirmation`, `App.jsx:784-799` renders it with Cancel and
> Remove, and it reaches the row through
> `App` → `SectionRenderer` → `renderNode` → `ListRenderer` → `useListItems`,
> where `removeItem` (`useListItems.js:135`) routes through `onShowConfirmation`
> when it is supplied. Six existing tests assert that flow and its exact copy.
>
> The draft missed it by grepping for `AlertDialog|ConfirmDialog|are you sure`
> inside `src/renderers` and `src/components`. The dialog lives in `App.jsx`, is
> built from `Dialog` rather than `AlertDialog`, and its body reads "This can't be
> undone." Three misses compounding into a confident wrong answer, recorded here
> because the same three would compound again.

## 1. Chip paste

**File:** `frontend/src/components/ArrayInput.jsx`

An `onPaste` handler splits the pasted text on `/[,\n]/`, trims each piece and
drops empties.

Two rules that are not obvious and that decide whether this feels right:

**A paste with no delimiter falls through to the browser's normal paste.** It
does not commit a chip. Someone pasting `React` may be pasting a fragment they
intend to finish typing, and committing it would make the input unusable for
that. Only a paste that *contains* a delimiter commits anything.

**A delimited paste commits every piece and clears the input.**
`"React, Vue, Svelte"` gives three chips and an empty input, whether or not it
ended on a delimiter.

> **Corrected 2026-08-12, by owner ruling.** This section first said the last
> piece stays in the input unless the paste ends on a delimiter, so that
> `"React, Vue, Sve"` left `Sve` to finish. That rule and the rule above are
> inconsistent about identical input — `"React, Vue, Svelte"` and
> `"React, Vue, Sve"` are both three pieces with no trailing delimiter — and the
> plan built from this spec asserted both, which made five of its twelve tests
> unsatisfiable. Task 3's implementer found it by transcribing the handler and
> the tests verbatim and reporting that they disagreed.
>
> Committing everything won on the merits, not just to resolve the clash: pasting
> a finished list is the common case, and withholding its last value put an extra
> Enter in the way of it. The "still writing" case is already served by the
> no-delimiter fall-through above, which is the rule that actually earns its keep.

Text already typed in the input becomes the first value rather than being
discarded, since the input is cleared on a delimited paste and leaving it out
would silently lose it.

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

## 3. Remove behind an overflow menu

**File:** `frontend/src/renderers/ListRenderer.jsx`

The `Trash2` icon button at `:604` becomes a `⋯` `DropdownMenu` trigger holding
one destructive `Remove` item. The item calls the same `removeItem(idx)` it calls
today, so the confirmation dialog and everything behind it are untouched.

**The pin star stays inline.** It is a positive, idempotent, one-click action, and
burying it would cost a click to buy nothing. The parent spec's argument is about
destructive actions specifically: "Destructive actions do not belong one stray
click from a row body."

**`useListItems` does not change.** `removeItem` already routes through
`onShowConfirmation`, and nothing about the menu alters list semantics.

### The dependency this needs

There is no `DropdownMenu` in this project. `src/components/ui/` holds 19
components and none of them is it, and `@radix-ui/react-dropdown-menu` is not in
`package.json` — which lists seven other `@radix-ui/*` packages, including the
`react-dialog` the confirmation is built from.

So slice 2b adds a dependency. `@radix-ui/react-dropdown-menu` plus the shadcn
`dropdown-menu.jsx` adapted for this project, which is where every other file in
`ui/` came from. Adapt rather than hand-roll: a menu owes focus trapping, arrow-key
navigation, typeahead, Escape, click-outside and `aria-*` wiring, and Radix has
all of it. Watch the React 18 / Tailwind 3 / plain-JSX constraints — the registry's
current output targets React 19, Tailwind 4 and TypeScript.

### Undo was considered and is not in this slice

Decided 2026-08-12 by the owner, after the correction above, choosing between
keeping the confirmation and adding only the menu, replacing the confirmation with
an undo toast, and doing both.

Keeping the confirmation won. Undo is the better affordance in the abstract, but
here it would mean **deleting a working safety net to add a weaker one**: the
dialog blocks before the write, undo only offers a window after it, and that window
does not survive a navigation or a closed tab because the removal has already
autosaved. Trading a block for a window is not obviously an improvement, and it is
certainly not one worth making as a side effect of adding a menu.

It also would have forced the dialog's "This can't be undone." to become false, and
that string is asserted by two existing tests.

Recorded rather than dropped: if row removal ever stops being a two-click
confirmed action, undo is the affordance to reach for, and a server-side soft
delete is what would make it hold across a navigation.

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

Every behavioural assertion that exists today survives untouched. One mechanical
change to existing tests is unavoidable, and it is worth being exact about which
kind it is.

**Twelve call sites depend on the remove control's accessible name, in two
different ways.**

*Nine, all in `ListRenderer.test.jsx`* (`:164`, `:387`, `:434`, `:451`, `:581`,
`:752`, `:753`, `:1075`, `:1363`), click it to remove a row via
`getByRole("button", { name: "Remove <title>" })`. Behind a menu that control does
not exist until the trigger is clicked, and a Radix menu item has role `menuitem`,
not `button`. Each gains a step that opens the row's `⋯` and changes the role it
queries.

*Three, all in `SectionRenderer.test.jsx`* (`:1091`, `:1888`, `:2316`), never
remove anything. They use the button's accessible name as the only unique per-row
handle in the markup, then walk up to the row and scope `within(row)` queries to
it. `:1091` says so in a comment: the row has no title text, so "it is reachable
only through the remove button's generated label". These need the new trigger's
name and nothing else — the DOM traversal is unaffected, because
`DropdownMenuTrigger asChild` clones the button rather than wrapping it, so it
stays the same child of the same parent at the same depth.

`StringsRenderer.test.jsx:117` also matches `name: "Remove …"` and must **not**
change: its `Remove highlight 2` comes from `StringsRenderer.jsx:82`, a different
component removing a bare string from an array.

What any of these tests assert does not change: removal still routes through
`onShowConfirmation`, `onItems` is still not called until the confirm callback
runs, the dialog copy is still `"Remove Scandinavian?"` / `"This can't be
undone."`. Only the path to the control changes. No assertion is weakened, and no
test is edited to make anything pass.

**No test asserts either label class today** (checked across
`src/renderers/*.test.jsx` and `src/components/*.test.jsx`), so §4 forces no test
edits at all. The two frozen fixtures, `field-census-v1.json` and
`control-census-v1.json`, record field names and control kinds; neither records a
class, so neither moves.

| Area | Cases |
|---|---|
| `ArrayInput` (new file) | delimiter-free paste falls through and commits nothing; comma-delimited paste commits chips; newline-delimited likewise; mixed delimiters; trailing delimiter leaves the input empty; no trailing delimiter leaves the last piece in the input; whitespace-only pieces dropped; a duplicate is accepted, matching Enter; Enter still commits after the `onKeyDown` swap |
| `ListRenderer` search | hidden at exactly 6, shown at 7; hidden at 6 but shown when a query is active; a node without `search` never shows a box at any count; facets unaffected at 6 |
| `ListRenderer` menu | Remove is inside the `⋯` menu and absent from the row body until it opens; it still reaches `onShowConfirmation` with the same title and body; the menu item is destructive; the pin star is still inline and outside the menu; the trigger has an accessible name naming its row |
| `useListItems` | unchanged, and its 2 confirmation tests must still pass untouched — the proof that this slice did not disturb list semantics |

The menu trigger needs an accessible name per row (`More actions for
<title>`-shaped), because nine tests and every screen-reader user need to tell one
row's menu from another's.

## Out of scope

- **Undo, and the server-side soft delete that would make it hold.** Reasoned
  through in §3. If row removal ever stops being a confirmed two-click action,
  this is the affordance to revisit.
- Chip deduplication, on either entry route. Its own decision if it is wanted.
- Undo for chip removal in `ArrayInput`. A chip is one word and cheap to retype;
  a list row is a form.
- The parent spec's per-card empty states and save tick. Both landed in slice 2.
- Anything in `ScalarField`'s control selection. `controlCensus` freezes it, and
  nothing here changes which control a field resolves to.
- Replacing the other icon-only row actions with menu items. Only the destructive
  one moves.
