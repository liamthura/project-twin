// Top-level entry point for rendering a pack's `ui` block. Normalises the
// pack's `ui` (old flat map or new explicit `ui.sections` form) via
// `normalizeUi`, then dispatches each node by `kind` via `renderNode`.
//
// STRUCTURE, as of migration slice 2. The section used to be a single Card
// holding every node under nested headings, which made a manifest of any size
// read as one long form. It is now:
//
//   Profile                          <- title block, h2 + description, no card
//   ┌─ card ─┐ ┌─ card ─┐            <- a run of ungrouped leaves, 16 apart
//   CONTACT & LINKS ──────────       <- an eyebrow band: one group, one run
//   ┌─ card ─┐ ┌─ card ─┐            <-   its children, two-across
//
// Two visual tiers, capped: band, then card. A group nested inside a group does
// NOT get a second band -- it becomes a labelled block inside its parent's
// card, and so does anything deeper. The manifest format allows arbitrary
// nesting; the design deliberately cannot express it, so no future manifest can
// invent a hierarchy the reader has to learn.
//
// A run is one group, or one consecutive stretch of ungrouped leaves. 32 between
// runs, 16 inside one. A leaf that FOLLOWS a group starts its own run rather
// than joining it -- the prototype trails two such cards under the previous
// eyebrow, which reads as membership the manifest does not have and the rail
// does not show. Recorded as a divergence in the slice 2 plan.
//
// What this file owns beyond the above: the React key, binding each node's path
// against the section's own `data`, the scroll-spy anchors, and a per-node
// header ACTION slot -- an empty container in the card header that a list node's
// own `+ Add` trigger is portalled into. headerActionSlot.jsx explains at length
// why the trigger cannot simply be built here.
import { useEffect, useRef, useState } from "react";

import { InfoButton } from "@/components/ui/info-button";
import { getAt, setAt, normalizeUi, outline } from "./paths";
import { renderNode } from "./renderNode";
import { HeaderActionSlotContext } from "./headerActionSlot";
import { EyebrowBand } from "./EyebrowBand";
import { SubsectionCard } from "./SubsectionCard";
import { fillSummary } from "./fillSummary";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation, savedAt }) {
  const { sections } = normalizeUi(pack);

  // The rail's scroll-spy anchors, keyed by the node's index among the section's
  // top-level children.
  //
  // Read from outline() rather than recomputed here on purpose. The rail renders
  // its sub-items from the same function, and two derivations of the same id is
  // the one thing this contract cannot afford: they would agree until a title
  // gained an apostrophe. See the umbrella spec's anchor contract.
  const bandById = new Map(outline(pack).map((b) => [b.index, b.id]));

  // The DOM element each list node's header action portals into, keyed by that
  // node's own React key. Kept in state rather than a ref because the element
  // has to reach a DESCENDANT (ListRenderer, via HeaderActionSlotContext) --
  // a ref would be populated after the render that needed it and nothing would
  // re-render to notice. So the first pass hands the child `null`, which it
  // handles by rendering its trigger inline, and the ref callback below
  // triggers exactly one more pass that portals it into place.
  //
  // Keyed per node, not one slot for the section: a section may hold several
  // list nodes (projects, knowledge, preferences all do), and a single shared
  // element would collect every one of their triggers in one row.
  const [slotEls, setSlotEls] = useState({});
  // One ref callback per key, cached so its identity survives a re-render.
  // That matters more than it looks: React re-invokes a callback ref whose
  // identity changed, so a fresh inline arrow would be detached (called with
  // null) and re-attached (called with the element) on every single commit --
  // two state writes per render, a new state object each time, and a render
  // loop that never settles. A stable callback is invoked only on real mount
  // and unmount, which also means the null it receives is a genuine unmount
  // and can be stored rather than ignored.
  const slotRefs = useRef({});
  const captureSlot = (key) => {
    if (!slotRefs.current[key]) {
      slotRefs.current[key] = (el) =>
        setSlotEls((prev) => (prev[key] === el ? prev : { ...prev, [key]: el }));
    }
    return slotRefs.current[key];
  };
  // The empty container a node's trigger is portalled into, in the header row of
  // that node's own card.
  const actionSlot = (key) => (
    <div key={`slot:${key}`} ref={captureSlot(key)} className="flex items-center gap-1" />
  );
  // Only a `list` node has an action to place, so only a list node gets a slot
  // -- a `strings` or `fields` node would otherwise contribute an empty div to
  // every card header it renders.
  const wantsSlot = (node) => node.kind === "list";

  // Which card, if any, is showing a save tick, and where in its 200ms-in /
  // 1.2s-hold / 200ms-out life it is. See the effect below.
  const [tick, setTick] = useState(null);
  const lastEditedRef = useRef(null);

  // The tick lands on the card whose node last changed. `savedAt` is App's
  // `lastSaved`, which updates on every successful write -- autosave flush or
  // an explicit Save now -- so this fires once per save and never on a mount
  // that merely inherited an older timestamp.
  //
  // The timers live here rather than in the card so the tick can move between
  // cards without one card's unmount cancelling another's. The hold is a timer
  // and not a keyframe because the reduced-motion block forces
  // animation-duration to 1ms on everything, which would erase it.
  useEffect(() => {
    if (!savedAt || !lastEditedRef.current) return;
    const key = lastEditedRef.current;
    setTick({ key, phase: "in" });
    const out = setTimeout(() => setTick({ key, phase: "out" }), 1400);
    const done = setTimeout(() => setTick(null), 1600);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [savedAt]);

  // The header's right-hand slot, decided by whether the node has a
  // denominator rather than by judgement. `fields` is the only kind that has
  // one -- the manifest fixes its key set -- so it is the only kind that gets a
  // count. `list` and `strings` are unbounded and get `+ Add` instead;
  // `scalar` gets nothing, because the control shows its own state.
  //
  // Geist Regular with tabular-nums, never mono: a count is a sentence
  // fragment, and rendering it in tracked mono is what made the old onboarding
  // summaries read as debug output.
  const countFor = (node, value) => {
    if (node.kind !== "fields") return null;
    const { filled, total } = fillSummary(node, value);
    if (total === 0) return null;
    return (
      <span data-fill-summary className="text-[13px] tabular-nums text-muted-foreground">
        {filled === 0 ? "Nothing yet" : `${filled} of ${total}`}
      </span>
    );
  };

  // One node, as one card. `depth` picks the heading level (which keeps
  // descending with the manifest even where the visual tier stops) and, past 0,
  // means "already inside a card" -- so a nested group renders as a labelled
  // block rather than a card of its own.
  function renderSectionNode(node, key, depth) {
    if (node.kind === "group") return renderNestedGroup(node, key, depth);

    const value = Array.isArray(node.path) ? getAt(data, node.path) : undefined;
    const rendered = renderNode({
      node,
      value,
      onValue: (next) => {
        // Which card the next successful save ticks. A ref, not state: nothing
        // renders differently until `savedAt` moves.
        lastEditedRef.current = key;
        onChange(setAt(data || {}, node.path, next));
      },
      entities: pack.entities,
      packKey: pack.key,
      onShowConfirmation,
    });
    // renderNode returns null (after logging) for a kind it doesn't support.
    // Bail out before the wrapper below so a rejected node contributes nothing
    // to the DOM -- not an empty card, and not a heading floating over nothing.
    if (!rendered) return null;

    const content = (
      // The node's content is rendered inside the slot context so a list node
      // can portal its `+ Add` trigger into its own card header while keeping
      // the add itself -- and the three invariants in useListItems -- where it
      // already works. See headerActionSlot.jsx.
      <HeaderActionSlotContext.Provider value={slotEls[key] ?? null}>
        {rendered}
      </HeaderActionSlotContext.Provider>
    );

    // Past the first tier there is no card to make: the node is a labelled
    // block inside its ancestor's card. Its title still descends a heading
    // level, so the outline keeps the shape the manifest declares.
    if (depth > 1) {
      return (
        <div key={key} data-ui-node={node.title} className="space-y-1.5">
          {node.title && <NodeLabel title={node.title} depth={depth} info={node.info} />}
          {node.description && (
            <p className="text-[13px] text-muted-foreground">{node.description}</p>
          )}
          {content}
        </div>
      );
    }

    const band = depth === 0 ? bandById.get(Number(key)) : undefined;
    return (
      <SubsectionCard
        key={key}
        // A node with no title of its own is the section's main list, and the
        // heading that names it is the pack's -- so its card borrows the pack
        // title rather than going bare. Figma 114:604 does exactly this: "Goals"
        // at 20px in the title block, again at 16px in the card header.
        title={node.title || pack.title}
        info={node.info}
        description={node.description}
        depth={depth}
        action={wantsSlot(node) ? actionSlot(key) : null}
        count={countFor(node, value)}
        tick={tick?.key === key ? tick.phase : null}
        data-ui-node={node.title}
        data-band={band}
        // Concatenated, never replacing: `scroll-mt` clears the 60px sticky
        // header so a rail click does not land with the title underneath it.
        className={band ? "scroll-mt-[60px]" : undefined}
      >
        {content}
      </SubsectionCard>
    );
  }

  // A group past the first tier. It gets no band and no card of its own: it is
  // ONE card titled with the group's name, holding its children as labelled
  // blocks. Anything deeper flattens into the same card.
  //
  // No shipping manifest nests a group inside a group; this is the path that
  // stops a future one inventing a third tier.
  function renderNestedGroup(node, key, depth) {
    const children = groupChildren(node, key, depth + 1);
    if (!children) return null;
    if (depth > 1) {
      return (
        <div key={key} data-ui-node={node.title} className="space-y-3">
          {node.title && <NodeLabel title={node.title} depth={depth} info={node.info} />}
          <div className="space-y-3">{children}</div>
        </div>
      );
    }
    return (
      <SubsectionCard
        key={key}
        title={node.title}
        info={node.info}
        description={node.description}
        depth={depth}
        data-ui-node={node.title}
      >
        <div className="space-y-3">{children}</div>
      </SubsectionCard>
    );
  }

  // A group's rendered children at `depth`, or null if it has nothing to show.
  // Emitting nothing -- rather than a label over an empty space -- is the same
  // rule a rejected node gets, and the reason both callers go through here is so
  // an empty group is reported once, in one wording.
  function groupChildren(node, key, depth) {
    if (!Array.isArray(node.sections) || node.sections.length === 0) {
      console.error(
        `SectionRenderer: group "${node.title}" in pack "${pack.key}" has no ` +
          `sections -- rendering nothing rather than a heading over an empty space`
      );
      return null;
    }
    const rendered = node.sections
      .map((child, i) => renderSectionNode(child, `${key}:${i}`, depth))
      .filter(Boolean);
    return rendered.length > 0 ? rendered : null;
  }

  // A top-level group: the eyebrow band, then its cards.
  function renderGroupRun(node, index) {
    const key = `${index}`;
    const cards = groupChildren(node, key, 1);
    if (!cards) return null;

    // Two-across, unless the group holds a `fields` node. Derived from all four
    // groups in the prototype: CODE STYLE (3 strings) wraps 2+1, CONTACT &
    // LINKS and LEARNING STYLE pair, and COMMUNICATION -- the only group with a
    // `fields` child -- is full width throughout. A `fields` card carries its
    // own two-column field grid and would collapse to one column in half a row.
    //
    // The rejected alternative was "grid always, and a `fields` card spans the
    // row": it reproduces Communication's fields card but then pairs
    // `When I'm feeling...` with `Response Format`, which the file stacks.
    //
    // lg and not md: at md the rail already takes 240 of 768px, which would
    // leave two cards about 230px wide.
    const twoUp = node.sections.every((child) => child.kind !== "fields");
    const band = bandById.get(index);

    return (
      <div
        key={key}
        data-ui-node={node.title}
        data-band={band}
        className={`space-y-4${band ? " scroll-mt-[60px]" : ""}`}
      >
        {node.title && (
          <EyebrowBand title={node.title} info={node.info} description={node.description} />
        )}
        <div data-card-grid className={`grid gap-4${twoUp ? " lg:grid-cols-2" : ""}`}>
          {cards}
        </div>
      </div>
    );
  }

  // A stretch of ungrouped leaves, stacked. Never gridded: the prototype shows
  // every ungrouped card full width, and these are the section's heaviest nodes
  // (profile's Personal Information holds seven fields).
  function renderLeafRun(items) {
    const cards = items
      .map(({ node, index }) => renderSectionNode(node, `${index}`, 0))
      .filter(Boolean);
    if (cards.length === 0) return null;
    return (
      <div key={`run:${items[0].index}`} className="space-y-4">
        {cards}
      </div>
    );
  }

  const runs = toRuns(sections);

  return (
    // space-y-8 = 32 between runs, and between the title block and the first
    // one. An empty run returns null and contributes no element, so it cannot
    // leave a gap behind.
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">{pack.title}</h2>
        {pack.description && (
          <p className="text-[13px] text-muted-foreground">{pack.description}</p>
        )}
      </div>
      {runs.map((run) =>
        run.kind === "group"
          ? renderGroupRun(run.items[0].node, run.items[0].index)
          : renderLeafRun(run.items)
      )}
    </div>
  );
}

// Each group is its own run; each consecutive stretch of leaves is its own run.
// Exported for its own test: the partition is the whole of the page's rhythm,
// and it is easier to state as data than to read out of the DOM.
export function toRuns(nodes) {
  const runs = [];
  (nodes || []).forEach((node, index) => {
    const last = runs[runs.length - 1];
    const isGroup = node.kind === "group";
    if (isGroup || !last || last.kind === "group") {
      runs.push({ kind: isGroup ? "group" : "leaves", items: [{ node, index }] });
    } else {
      last.items.push({ node, index });
    }
  });
  return runs;
}

// A title past the card tier: the `headline-3` class (globals.css), in the
// document outline at the level the manifest's nesting implies. h5 and h6
// look alarming in a component and are correct here -- the visual tier is
// capped at two, the outline is not.
function NodeLabel({ title, depth, info }) {
  const Heading = depth >= 3 ? "h6" : "h5";
  return (
    <div className="flex items-center gap-1.5">
      <Heading className="headline-3">{title}</Heading>
      <InfoButton info={info} title={title} />
    </div>
  );
}
