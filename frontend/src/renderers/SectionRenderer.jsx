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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoButton } from "@/components/ui/info-button";
import { getAt, setAt, normalizeUi } from "./paths";
import { renderNode } from "./renderNode";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation }) {
  const { sections } = normalizeUi(pack);

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
      const rendered = node.sections
        .map((child, i) => renderSectionNode(child, `${key}:${i}`, depth + 1))
        .filter(Boolean);
      // Every child rejected: emit nothing rather than a heading over nothing,
      // the same rule a rejected node gets below.
      if (rendered.length === 0) return null;
      return (
        <div key={key} data-ui-node={node.title} className="space-y-4">
          {heading(node, depth)}
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
        {node.title && heading(node, depth)}
        {rendered}
      </div>
    );
  }

  // A node's own heading row: its title, the "i" that explains it, and the one
  // muted line under both. Shared by groups and titled nodes so a description
  // renders for every kind -- it used to be StringsRenderer's alone, which
  // silently dropped the copy on `fields` and `list` nodes that declared one.
  function heading(node, depth) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          {depth === 0 ? (
            <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
          ) : (
            <h4 className="text-sm font-medium text-foreground">{node.title}</h4>
          )}
          <InfoButton info={node.info} title={node.title} />
        </div>
        {node.description && (
          <p className="text-xs text-muted-foreground">{node.description}</p>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
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
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((node, i) =>
          // key by index as well as path: two sibling nodes may legitimately
          // share a path, and a bare path join collides for them.
          renderSectionNode(node, `${i}:${Array.isArray(node.path) ? node.path.join(".") : ""}`, 0)
        )}
      </CardContent>
    </Card>
  );
}
