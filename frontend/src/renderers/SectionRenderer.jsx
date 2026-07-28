// Top-level entry point for rendering a pack's `ui` block. Normalises the
// pack's `ui` (old flat map or new explicit `ui.sections` form) via
// `normalizeUi`, then dispatches each node by `kind` via `renderNode`. Only
// `kind: "list"` is implemented in this wave -- later waves add more.
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoButton } from "@/components/ui/info-button";
import { getAt, setAt, normalizeUi } from "./paths";
import { renderNode } from "./renderNode";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation }) {
  const { sections } = normalizeUi(pack);

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
        {sections.map((node, i) => {
          // key by index as well as path: two sibling nodes may legitimately
          // share a path, and a bare path join collides for them.
          const key = `${i}:${Array.isArray(node.path) ? node.path.join(".") : ""}`;
          const rendered = renderNode({
            node,
            value: Array.isArray(node.path) ? getAt(data, node.path) : undefined,
            onValue: (next) => onChange(setAt(data || {}, node.path, next)),
            entities: pack.entities,
            packKey: pack.key,
            onShowConfirmation,
          });
          // renderNode returns null (after logging) for a kind it doesn't
          // support. Bail out before the wrapper div/heading below so a
          // rejected node contributes nothing to the DOM -- not an empty
          // div, and not a heading floating over nothing.
          if (!rendered) return null;
          return (
            <div key={key} className="space-y-3">
              {node.title && (
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
                  <InfoButton info={node.info} title={node.title} />
                </div>
              )}
              {rendered}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
