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

// What <input type="date"> will accept and round-trip. Anything else it
// discards on render, showing an empty picker.
//
// Exported because ListRenderer's `display_formats` needs the same test: a
// value matching this is a CALENDAR DATE, not an instant, and the two
// renderers have to agree on which values that means or the same string
// could round-trip through a picker one way and be reinterpreted through a
// timezone the other.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `id` is optional and only reaches the branches that render ONE form control
// (text, textarea, date). EnumControl is a group of buttons and ArrayInput has
// its own internal input, so neither can carry a caller's id meaningfully --
// a <Label htmlFor> aimed at those stays a visible caption without a
// programmatic association. FieldsRenderer is the caller that needs this;
// ListRenderer's edit grid labels its own cells and passes nothing.
export function ScalarField({ id, field, value, meta, onChange, customValue, onCustomChange }) {
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
  if ((meta.date_fields || []).includes(field)) {
    // A date field is only safe to render as a picker when what is stored is
    // actually a date. Nothing validates these on write -- an MCP client can
    // put "next spring" or "Q2 2027" into goals.target_date -- and
    // <input type="date"> silently drops any value it cannot parse, so a
    // picker would show empty and write that emptiness back on the next edit.
    // A non-ISO value therefore stays a text input: visible, editable, and
    // preserved. Clearing it hands the user the picker.
    if (!value || ISO_DATE.test(value)) {
      return (
        <Input
          id={id}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          // Ask the browser to draw its native picker in the app's theme,
          // otherwise the calendar renders light-on-light in dark mode.
          className="[color-scheme:light] dark:[color-scheme:dark]"
        />
      );
    }
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Not a yyyy-mm-dd date, so this stays a text field. Clear it to get a date picker."
      />
    );
  }
  if (longText.has(field)) {
    return (
      <Textarea id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} />
    );
  }
  return <Input id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}
