// Top-level entry point for rendering a pack's `ui` block. Normalises the
// pack's `ui` (old flat map or new explicit `ui.sections` form) via
// `normalizeUi`, then dispatches each node by `kind` via `renderNode`.
//
// Lifted from GenericSectionEditor.jsx's default export (its Card/CardHeader
// wrapper, kept exactly as GenericSectionEditor.jsx:252-258 rendered it) with
// these changes:
//   - entity/list resolution goes through normalizeUi instead of a
//     module-private entityByList loop
//   - the per-node `kind` dispatch (and any node whose kind isn't handled
//     logging loudly -- naming both the kind and the pack key -- rather than
//     being silently skipped) now lives in `renderNode`, not inline here;
//     SectionRenderer keeps only section-root concerns: the Card, the
//     node.title heading, the React key, and binding each node's path
//     against the section's own `data`
//   - `kind: "group"` is handled HERE rather than in renderNode: a group
//     binds no path and takes no value, so it has nothing renderNode's
//     signature is built around. It is a heading with nested sections, and
//     those sections bind against the same `data` root their ungrouped
//     siblings do.
//
// It also owns one thing that is not strictly section-root: a per-node header
// ACTION slot -- an empty container in the heading row that a list node's own
// `+ Add` trigger is portalled into. The trigger cannot simply be built here,
// and headerActionSlot.jsx explains at length why not.
import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoButton } from "@/components/ui/info-button";
import { getAt, setAt, normalizeUi } from "./paths";
import { renderNode } from "./renderNode";
import { HeaderActionSlotContext } from "./headerActionSlot";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation }) {
  const { sections } = normalizeUi(pack);

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
  // The empty container a node's trigger is portalled into. Rendered by
  // whichever header row owns that node -- the node's own NodeHeading if it is
  // titled, the Card's header row if it is not.
  const actionSlot = (key) => (
    <div key={`slot:${key}`} ref={captureSlot(key)} className="flex items-center gap-1" />
  );
  // Only a `list` node has an action to place, so only a list node gets a slot
  // -- a `strings` or `fields` node would otherwise contribute an empty div to
  // every heading row it renders.
  const wantsSlot = (node) => node.kind === "list";
  // A node with no title of its own is the section's main list, so the heading
  // that describes it is the Card's (see the CardTitle comment below) -- and
  // its Add action belongs in that same row for the same reason. Its slot is
  // therefore created up there, keyed by the same key withSeparators derives
  // for a top-level node: the bare index.
  //
  // Kept to the top level, exactly as the CardTitle's InfoButton map is: an
  // untitled node nested inside a group has no header row of its own AND no
  // claim on the Card's heading, so it sees no slot and falls back to its own
  // inline trigger. No manifest declares that shape today.
  const cardHeaderSlotKeys = sections
    .map((node, i) => ({ node, key: `${i}` }))
    .filter(({ node }) => !node.title && wantsSlot(node))
    .map(({ key }) => key);

  // One node, plus the heading/description/info wrapper it earns. Recursive so
  // a group's nested sections get the identical treatment one level in --
  // `depth` only picks the heading size, never the binding, because a nested
  // section's path resolves against the section root exactly like a top-level
  // one's does.
  function renderSectionNode(node, key, depth) {
    if (node.kind === "group") {
      if (!Array.isArray(node.sections) || node.sections.length === 0) {
        console.error(
          `SectionRenderer: group "${node.title}" in pack "${pack.key}" has no ` +
            `sections -- rendering nothing rather than a heading over an empty space`
        );
        return null;
      }
      const rendered = withSeparators(node.sections, `${key}:`, depth + 1);
      // Every child rejected: emit nothing rather than a heading over nothing,
      // the same rule a rejected node gets below.
      if (rendered.length === 0) return null;
      return (
        <div key={key} data-ui-node={node.title} className="space-y-4">
          <NodeHeading node={node} depth={depth} />
          <div className="space-y-4 border-l pl-4">{rendered}</div>
        </div>
      );
    }

    const rendered = renderNode({
      node,
      value: Array.isArray(node.path) ? getAt(data, node.path) : undefined,
      onValue: (next) => onChange(setAt(data || {}, node.path, next)),
      entities: pack.entities,
      packKey: pack.key,
      onShowConfirmation,
    });
    // renderNode returns null (after logging) for a kind it doesn't support.
    // Bail out before the wrapper below so a rejected node contributes nothing
    // to the DOM -- not an empty div, and not a heading floating over nothing.
    if (!rendered) return null;
    // `data-ui-node` is the stable handle a test scopes a node by. Walking up
    // from the heading text with .parentElement broke the moment the heading
    // gained a wrapper for `description`; this survives markup changes because
    // it names the node rather than describing where it sits.
    return (
      <div key={key} data-ui-node={node.title} className="space-y-3">
        {node.title && (
          <NodeHeading
            node={node}
            depth={depth}
            action={wantsSlot(node) ? actionSlot(key) : null}
          />
        )}
        {/* The node's content is rendered inside the slot context so a list
            node can portal its `+ Add` trigger into the header row above (or,
            for an untitled node, into the Card's own header row) while keeping
            the add itself -- and the three invariants in useListItems -- where
            it already works. See headerActionSlot.jsx for why the trigger is
            not simply built here instead. */}
        <HeaderActionSlotContext.Provider value={slotEls[key] ?? null}>
          {rendered}
        </HeaderActionSlotContext.Provider>
      </div>
    );
  }

  // Render a list of sibling nodes, with a rule after each GROUP that has
  // something rendering after it. Two things that condition buys:
  //   - no dangling rule under the last group, which is what a plain
  //     "separator after every group" would leave when a group sits last
  //     (lifestyle's Wellness, today)
  //   - a rule still lands between a group and a plain node that follows it
  //     (preferences' Learning Style -> Likes & Dislikes), which is exactly
  //     where the boundary is hardest to see
  // Ungrouped siblings get none: they are single controls, and ruling between
  // each would turn the card into a stack of boxes.
  //
  // `rendered` is filtered first, so a rejected trailing node cannot leave the
  // rule before it dangling either.
  function withSeparators(nodes, keyPrefix, depth) {
    const rendered = (nodes || [])
      .map((node, i) => ({ node, el: renderSectionNode(node, `${keyPrefix}${i}`, depth) }))
      .filter((r) => r.el);

    return rendered.flatMap(({ node, el }, i) =>
      node.kind === "group" && i < rendered.length - 1
        ? [el, <hr key={`sep:${keyPrefix}${i}`} className="border-border" />]
        : [el]
    );
  }

  return (
    <Card>
      <CardHeader>
        {/* One row: what this section is on the left, what you can do to it on
            the right. The action slots have to sit BESIDE the CardTitle rather
            than inside it -- a button nested in a heading element joins that
            heading's accessible name, so an untitled section would announce as
            "Goals Add" to a screen reader (and read that way in every
            heading-text assertion). */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-1.5">
              {pack.title}
              {/* A node with no title of its own is the section's main list, so
                  the heading that describes it is the Card's. Its "i" belongs
                  here rather than buried in the list body -- and a section whose
                  lists are all titled (knowledge) correctly shows none here,
                  because each list carries its own beside its own h3. */}
              {sections
                .filter((n) => !n.title && n.info)
                .map((n, i) => (
                  <InfoButton key={i} info={n.info} title={pack.title} />
                ))}
            </CardTitle>
            <CardDescription>{pack.description}</CardDescription>
          </div>
          {/* And, for the same reason, an untitled node's `+ Add`: this row is
              the only header it has. One slot per such node, so two of them
              could never end up sharing a container (no manifest ships two,
              but keying them per node is what makes that unable to happen). */}
          {cardHeaderSlotKeys.map((key) => actionSlot(key))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Keys carry the index as well as the path: two sibling nodes may
            legitimately share a path, and a bare path join collides for them.
            withSeparators appends the index to this prefix. */}
        {withSeparators(sections, "", 0)}
      </CardContent>
    </Card>
  );
}

// A node's own heading row: its title, the "i" that explains it, the optional
// action on the right, and the one muted line under all three. Shared by groups
// and titled nodes so a description renders for every kind -- it used to be
// StringsRenderer's alone, which silently dropped the copy on `fields` and
// `list` nodes that declared one.
//
// `action` is a slot, not a rendered control: what lands in it is a bare
// container that a list node's own `+ Add` trigger is portalled into. See
// headerActionSlot.jsx.
export function NodeHeading({ node, depth, action }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {depth === 0 ? (
            <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
          ) : (
            <h4 className="text-sm font-medium text-foreground">{node.title}</h4>
          )}
          <InfoButton info={node.info} title={node.title} />
        </div>
        {action}
      </div>
      {node.description && (
        <p className="text-xs text-muted-foreground">{node.description}</p>
      )}
    </div>
  );
}
