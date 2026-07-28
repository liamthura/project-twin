// Picks a single control for one field. Lifted from GenericSectionEditor's
// module-private FieldInput with one change: instead of reaching into a
// pack entity directly, everything the control needs arrives pre-resolved
// via `meta`. That indirection is the whole point -- it is what lets later
// renderer waves feed ScalarField inline enums for sections whose manifest
// field names are not their storage keys, without ScalarField ever knowing
// where valid_values came from.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrayInput } from "@/components/ArrayInput";
import { EnumControl } from "@/components/controls";

// Default long-text field set, exported so callers that don't supply their
// own `meta.long_text` can pass this one through.
export const LONG_TEXT_FIELDS = new Set(["notes", "why", "description"]);

export function ScalarField({ field, value, meta, onChange, customValue, onCustomChange }) {
  // meta.long_text is documented as a Set (that's what every caller inside
  // this codebase passes), but the published schema declares the manifest's
  // `long_text` key as a JSON array, and a node built straight from a
  // manifest (`node.long_text`) is exactly that -- an array with no `.has`.
  // Normalise here, at the one place that reads it, so an array-shaped
  // long_text degrades to nothing worse than a Set-shaped one instead of
  // silently turning every declared textarea into a one-line input.
  const longText =
    meta.long_text instanceof Set ? meta.long_text : new Set(meta.long_text ?? []);
  const enums = meta.valid_values?.[field];
  if (enums) {
    const customField = `custom_${field}`;
    const hasCustom = (meta.optional || []).includes(customField);
    return (
      <div className="space-y-2">
        <EnumControl options={enums} value={value} onChange={onChange} />
        {hasCustom && value === "other" && (
          <Input
            value={customValue || ""}
            onChange={(e) => onCustomChange?.(e.target.value)}
            placeholder={`Custom ${field.replace(/_/g, " ")}…`}
            className="h-8 max-w-[240px]"
            autoFocus
          />
        )}
      </div>
    );
  }
  if ((meta.array_fields || []).includes(field)) {
    return <ArrayInput items={value || []} onChange={onChange} placeholder={`Add ${field}…`} />;
  }
  if (longText.has(field)) {
    return <Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} />;
  }
  return <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}
