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
import { getAt, setAt, normalizeUi } from "./paths";
import { renderNode } from "./renderNode";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation }) {
  const { sections } = normalizeUi(pack);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{pack.title}</CardTitle>
        <CardDescription>{pack.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((node, i) => {
          // key by index as well as path: two sibling nodes may legitimately
          // share a path, and a bare path join collides for them.
          const key = `${i}:${Array.isArray(node.path) ? node.path.join(".") : ""}`;
          return (
            <div key={key} className="space-y-3">
              {node.title && (
                <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
              )}
              {renderNode({
                node,
                value: Array.isArray(node.path) ? getAt(data, node.path) : undefined,
                onValue: (next) => onChange(setAt(data || {}, node.path, next)),
                entities: pack.entities,
                packKey: pack.key,
                onShowConfirmation,
              })}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
