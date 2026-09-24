/**
 * Which sections are on, in one place.
 *
 * Switching a section off is not a view preference: the section leaves the
 * editor AND every AI read and write path (get_context, search_context,
 * get_entity, get_raw, persona_modify all check it). A control that strong
 * belongs here, stated plainly, rather than as a "Hide" button in each
 * section's header that read like it only tidied the menu.
 */
import { Switch } from "@/components/ui/switch";

export function SectionsPanel({ packs = [], onTogglePack }) {
  const optional = packs.filter((p) => !p.core);
  const alwaysOn = packs.filter((p) => p.core);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        A section that is off leaves the editor, and AI clients can no longer read
        or change it. Nothing in it is deleted: switch it back on and it returns
        exactly as it was.
      </p>

      <ul className="divide-y rounded-lg border">
        {optional.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-6 p-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{p.title}</p>
              {p.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
              )}
            </div>
            <Switch
              checked={p.enabled}
              onCheckedChange={(next) => onTogglePack?.(p.key, next)}
              aria-label={p.title}
            />
          </li>
        ))}
      </ul>

      {alwaysOn.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Always on: {alwaysOn.map((p) => p.title).join(", ")}.
        </p>
      )}
    </div>
  );
}
