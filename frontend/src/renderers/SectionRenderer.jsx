// Top-level entry point for rendering a pack's `ui` block. Normalises the
// pack's `ui` (old flat map or new explicit `ui.sections` form) via
// `normalizeUi`, then dispatches each node by `kind`. Only `kind: "list"` is
// implemented in this wave -- later waves add more.
//
// Lifted from GenericSectionEditor.jsx's default export (its Card/CardHeader
// wrapper, kept exactly as GenericSectionEditor.jsx:252-258 rendered it) with
// these changes:
//   - entity/list resolution goes through normalizeUi instead of a
//     module-private entityByList loop
//   - list bodies are delegated to ListRenderer instead of an inline PackList
//   - any node whose kind isn't handled logs loudly (console.error naming
//     both the kind and the pack key) and renders nothing for that node,
//     rather than being silently skipped -- a silent skip is how a migrated
//     section loses a whole list without anyone noticing
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAt, setAt, normalizeUi } from "./paths";
import ListRenderer from "./ListRenderer";

export default function SectionRenderer({ pack, data, onChange, onShowConfirmation }) {
  const { sections } = normalizeUi(pack);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{pack.title}</CardTitle>
        <CardDescription>{pack.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((node) => {
          const key = node.path.join(".");
          if (node.kind !== "list") {
            console.error(
              `SectionRenderer: unsupported node kind "${node.kind}" in pack "${pack.key}"`
            );
            return null;
          }
          const items = getAt(data, node.path);
          return (
            <div key={key} className="space-y-3">
              {node.title && (
                <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
              )}
              <ListRenderer
                node={node}
                entity={pack.entities?.[node.entity]}
                items={Array.isArray(items) ? items : []}
                onItems={(next) => onChange(setAt(data || {}, node.path, next))}
                onShowConfirmation={onShowConfirmation}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
