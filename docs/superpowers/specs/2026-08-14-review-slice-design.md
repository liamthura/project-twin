# Review slice — design

Date: 2026-08-14
Status: approved, not yet planned
Umbrella: `docs/superpowers/specs/2026-08-10-app-migration-umbrella-design.md`
Sketch this refines: `docs/superpowers/specs/2026-08-04-mygist-app-reshaped-design.md`, section "## Review"

## What this slice does

The review queue is the only surface where an agent's guess becomes the
reader's data, and today every item in it looks the same. A one-word `add
hobby` proposal gets the same card as an observation that needs a real
decision about where it belongs. Reviewing ten fast items means scrolling
through ten cards.

This slice splits the two by how much thought each needs. Inbox items become
one line each. Observations keep their card. Two `Tabs` carry the counts, so
the queue says how much is waiting without being opened.

It also tightens the `propose_update` tool contract, because a dense row only
works if proposals arrive compact. An agent that resends all eight fields of
`work_experience` to change one turns every row into `+7 more`.

## Component decomposition

`ProposalsPanel.jsx` is 404 lines today and this slice adds five things to it.
It splits into five files:

| File | Holds | ~lines |
| --- | --- | --- |
| `ProposalsPanel.jsx` | fetch, poll, `act()`, tabs, empty states | 200 |
| `proposalSummary.js` | the row-summary rule, pure | 40 |
| `InboxRow.jsx` | one dense row and its expanded detail | 110 |
| `ObservationCard.jsx` | the card, unchanged in substance | 70 |
| `PromoteDialog.jsx` | dialog, selects, `promotionTargets` | 130 |

`proposalSummary.js` gets its own file because it is the branchiest thing in
the slice. Keeping it pure means it can be tested against every entity in
`packs.json` without rendering anything.

`promotionTargets` moves into `PromoteDialog.jsx` and stays exported.
`ProposalsPanel.test.jsx` imports it today and updates to the new path.

The panel still needs it. `ObservationCard` disables its Promote button when no
enabled pack can receive a note, so the panel imports `promotionTargets` from
`PromoteDialog.jsx`, computes the `promotable` list once, and passes it to both
`ObservationCard` and `PromoteDialog`. One computation, two consumers.

## Tabs and counts

`KINDS`' two `Button`s become `Tabs`, `TabsList` and `TabsTrigger`. This gives
`frontend/src/components/ui/tabs.jsx` its first importer — it has been in the
repo unused, and was on the list of files to delete until this slice.

```
Inbox 3  ·  Observations 2
```

Counts come from `GET /api/proposals/count`, which already returns
`{entity, note, total}` and deliberately does not mark rows seen. That last
part is what makes it safe for a badge: `list_pending` marks rows seen, and a
row marked seen loses its eviction protection. A count that quietly did the
same would strip protection off observations the reader has never looked at,
which `backend/tests/test_proposals_api.py:87` already guards.

The panel fetches the count on the same 15s tick as the list and passes
`total` up through a new `onCounts` prop.

`proposalCount()` in `lib/api.js` already exists and has no callers — App
calls `api("/proposals/count")` directly and keeps only `total`. It changes to
return the whole `{entity, note, total}` object, which is safe precisely
because nothing reads it yet.

**`onCounts` replaces `onResolved`.** Today, resolving an item calls
`onResolved`, which makes App fetch the count again — a second request for a
number the panel is about to fetch anyway. Instead the panel refreshes its own
counts after a resolution and hands the total up. One request instead of two.

*(Corrected 2026-08-14, while planning: an earlier draft of this section said
App should also drop its `activeSection !== "review"` exception. That was
wrong. The exception is what stops App polling the count while the panel is
already polling it; removing it would mean two pollers instead of one. App
keeps the exception unchanged.)*

## The inbox row

```
Add     hobby             bouldering              ✓  ✕  ⌄
Update  preference        tone → direct           ✓  ✕  ⌄
Add     hobby specific    climbing → bouldering   ✓  ✕  ⌄
Add     work experience   Acme  +3 more           ✓  ✕  ⌄
Remove  goal              ship the beta           ✓  ✕  ⌄
```

Approve and reject work from the collapsed row. The chevron expands in place to
what the card shows today: the full field list, the rationale, and the evidence
quote.

The collapsed row has no room for the `proposed_by` badge or `seen N×`, so both
move into the expanded detail. Observations keep them on the card face, where
they inform a decision the reader is about to make.

### The summary rule

`proposalSummary(row, packs)` returns `{lead, trail, extra}`. It resolves the
entity's spec from the packs the panel already receives, then:

1. The entity declares a `parent` → `lead` is the parent's value, `trail` is
   the identifier's value.
2. Otherwise exactly one non-identifier field carries a value → `lead` is the
   identifier's value, `trail` is that field's value.
3. Otherwise → `lead` is the identifier's value, `trail` is empty, and `extra`
   counts the fields not shown.

The parent case is checked first on purpose. `hobby_specific` has identifier
`specific` and parent `hobby_name`, so rule 2 alone would render
`bouldering → climbing`, backwards.

The row renders `lead`, then `→ trail` when there is a trail, then `+N more`
when `extra` is non-zero. Both can appear: `project_reference` with a URL reads
`Atlas → docs +1 more`.

### When the entity does not resolve

A pack can be disabled, an entity renamed, or a proposal left over from an
older schema. When no spec is found, `lead` falls back to the first value in
`data` and `extra` counts the rest. The row stays readable and still
approvable rather than rendering blank.

## Observations

The card keeps its current shape, wording and behaviour. Promoting one is a
real decision about where something belongs, and the card is the surface that
supports it.

## The promote dialog

Two raw `<select>` elements share a hand-rolled `selectClass` string today.
They are replaced with shadcn `Select` from `components/ui/select.jsx`, which
already exists. This deletes the last raw select in the app.

Type stays dependent on Section: changing Section resets Type to that section's
first target, as it does now. The editable text field keeps its behaviour and
its comment — it is the last point before an agent's phrasing becomes the
reader's data.

`npm ls` confirms `@radix-ui/react-select@2.2.6` gets deduped copies of
`react-dismissable-layer`, `react-focus-scope` and `react-focus-guards`,
matching what `react-dialog` resolves. So a Select inside a Dialog does not hit
the duplicated-module-state fault that broke the overflow menu in slice 2b. The
test described below is what keeps that true.

## Empty states

Two situations, worded separately, because they have different fixes:

```
— nothing connected —
Nothing waiting. Agents propose changes here as they notice them.
Nothing is connected yet.  [ Connect an app ]

— connected, but none can propose —
Nothing waiting. Agents propose changes here as they notice them.
Claude Desktop can read your persona but not suggest changes to it.
[ Review access ]
```

The panel calls the existing `listConnectedApps()` from `lib/api.js`, which
returns `{id, clientId, clientName, scopes, createdAt}` with display names
already resolved and cached per `clientId`. It is called once, and only when
the queue is empty, so it never runs for a reader who has proposals waiting.

If the call fails the extra line does not render. That is what happens today,
so nothing is lost.

Grants live in the auth service and are read with the browser's session cookie,
not the Bearer token the Python API uses. Putting this behind `/proposals/count`
was considered and rejected: it would add a cross-service call plus a name
lookup per client to an endpoint polled from every open tab.

## The `propose_update` contract

Two changes in `backend/server.py`.

### The docstring states the compact shape

`propose_update`'s docstring never says how much to send. `_example_data` at
`server.py:2694` already does, for `persona_modify`:

```
add    -> all required fields + one sample optional
update -> parent + identifier (to locate) + one sample optional (to change)
remove -> parent + identifier only
```

The docstring restates this for proposals, and gives `rationale` a length: one
sentence saying why the thing is durable. This aligns propose with modify
rather than inventing a rule.

### The server narrows an update before storing it

**Deferred to its own spec and plan (decided 2026-08-14).** Planning showed
this is a sub-slice, not a bolt-on. `execute_modify` is a per-entity if/elif
chain where each branch hand-resolves its own file and nested path, so there
is no generic "given entity and identifier, fetch the stored record" to build
on. Making one needs a manifest path-walker written beside `derive_entities`
— which must stay pure and whose output `test_converter.py` freezes key for
key — plus alias translation through `normalize_data`, because proposals carry
MCP spellings while storage uses stored names. Getting it wrong silently
discards a field the reader wanted changed, which is not a thing to rush.

The design below is what that plan should implement. Everything above it, and
the docstring change, ship in this slice.

---

When `action` is
`update`, the server locates the existing item with `find_in_array`
(`server.py:244`, the same exact identifier lookup the write path uses) and
drops from `data` every field whose value already matches what is stored.

- The identifier and any parent field are always kept. They locate the record,
  they do not change it.
- The narrowing runs only for `update`. An `add` carries no prior record to
  diff against, and a `remove` is identifier-only already.
- If the record is not found, `data` is stored unchanged. A proposal to update
  something absent already fails at approval, and that is not this slice's
  problem to solve.
- If nothing differs, the proposal is not stored. The result is `no_change`,
  a new value beside `stored`, `duplicate_pending`, `previously_rejected`,
  `conflicts_with_existing` and `invalid`.

`fingerprint()` is computed from `entity` and `identifier`, never from `data`,
so narrowing cannot change deduplication behaviour.

This is not the fuzzy matcher. `_find_strong_match` is an advisory duplicate
detector over embeddings and FTS, and can match a merely similar record.
Narrowing against an approximate match could discard a real change, so it uses
the exact lookup instead.

## Testing

`proposalSummary` gets a table test covering every entity in
`frontend/src/__fixtures__/packs.json`, in both directions: every entity
produces a summary, and each of the three branches is reached by a real entity.
A manifest change that breaks the rule then fails here rather than in the UI.

**One test renders the real `PromoteDialog`, with a real `Select`, inside a
real `Dialog`.** It opens the select, picks an option, and asserts three
things: the chosen option's text appears in the trigger, focus is still inside
the dialog, and `document.body.style.pointerEvents` is `""` so the rest of the
dialog is still clickable. It then confirms the promote and asserts the handler
fired with the chosen entity. This is the shape of
`rowRemovalConfirmation.test.jsx`, and it
exists for the reason that test exists: in slice 2b, five individually clean
task reviews shipped a menu that could not open a dialog, because no test in
the repo rendered two Radix layer components together.

That test fails by hanging rather than by going red. The plan must give it an
explicit timeout so a regression reports as a failure and not as silence.

Backend tests for narrowing move to that slice's plan: an update that changes
one field of eight stores one field plus the identifier; an update that changes
nothing returns `no_change`; an update against a missing record stores
unchanged; an `add` with values matching an existing record is untouched.

This slice's only backend change is the `propose_update` docstring, so its test
is that `test_propose_update.py` still passes.

## Out of scope

- **Keyboard shortcuts.** `j`/`k`/`a`/`r`/`e` and the `?` overlay are deferred.
  They need roving focus and a shortcut layer that stays quiet while the
  promote dialog or a text input has focus, which is its own slice.
- **Bulk approve.** Deliberately absent. A select-all checkbox is how "nothing
  reaches your persona until you approve it" stops being true. The dense row
  already makes approving one item about as fast as ticking a box.
- **Trimming long rationales.** Considered and dropped. It would silently alter
  an agent's words, and narrowing `data` fixes the row density that prompted
  the concern.

## Files touched

Frontend:

- `components/ProposalsPanel.jsx` — rewritten smaller
- `components/proposalSummary.js` — new
- `components/InboxRow.jsx` — new
- `components/ObservationCard.jsx` — new
- `components/PromoteDialog.jsx` — new
- `components/ProposalsPanel.test.jsx` — split alongside the components
- `App.jsx` — `onCounts`, and the polling exception removed

Backend:

- `server.py` — `propose_update` docstring, `_narrow_update`, `no_change`
- `tests/test_proposals_api.py` — narrowing cases

Docs: none. `capture.mdx`, `clients.mdx` and `faq.mdx` mention `propose_update`
but describe what it does, never its payload shape or its result values, so
adding `no_change` leaves them accurate.
