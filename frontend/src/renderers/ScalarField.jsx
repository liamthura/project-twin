// Picks a single control for one field. Lifted from GenericSectionEditor's
// module-private FieldInput with one change: instead of reaching into a
// pack entity directly, everything the control needs arrives pre-resolved
// via `meta`. That indirection is the whole point -- it is what lets later
// renderer waves feed ScalarField inline enums for sections whose manifest
// field names are not their storage keys, without ScalarField ever knowing
// where valid_values came from.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ArrayInput } from "@/components/ArrayInput";
import { EnumControl } from "@/components/controls";
import { DatePicker } from "@/components/DatePicker";
import { parseIsoDate } from "./isoDate";

// Default long-text field set, exported so callers that don't supply their
// own `meta.long_text` can pass this one through.
export const LONG_TEXT_FIELDS = new Set(["notes", "why", "description"]);

// The stored calendar-date shape, defined in ./isoDate beside the parsing that
// has to agree with it, and re-exported here because ListRenderer's
// `display_formats` imports it from this module. One declaration: a value
// matching this is a CALENDAR DATE, not an instant, and the two renderers have
// to agree on which values that means or the same string could round-trip
// through a picker one way and be reinterpreted through a timezone the other.
export { ISO_DATE } from "./isoDate";

// What <input type="time"> will accept and round-trip. Same contract as
// the date shape above and same hazard: a value the picker cannot parse is
// shown as empty
// and written back as empty on the next edit. Seconds are optional because the
// browser emits "HH:MM:SS" when a step is set, and a stored value in that form
// must not be demoted to a text input.
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// `id` is optional and only reaches the branches that render ONE form control
// (text, textarea, date). EnumControl is a group of buttons and ArrayInput has
// its own internal input, so neither can carry a caller's id meaningfully --
// a <Label htmlFor> aimed at those stays a visible caption without a
// programmatic association. FieldsRenderer is the caller that needs this;
// ListRenderer's edit grid labels its own cells and passes nothing.
export function ScalarField({ id, field, value, meta, onChange, customValue, onCustomChange }) {
  // meta.long_text is documented as a Set, and every caller inside this
  // codebase passes one -- `buildFieldMeta` (fieldMeta.js) always builds it as
  // one, for the only path it has left after Task 10 deleted the pre-v2 branch
  // that used to read a manifest's own `long_text` array straight off the
  // node. That array shape is gone from the schema too (meta_schema.json
  // declares no such key any more). Still normalised here rather than trusted,
  // because `meta` is this component's public parameter, not something only
  // `buildFieldMeta` may construct -- a hand-built array-shaped `long_text`
  // (this file's own tests build one) degrades to nothing worse than a
  // Set-shaped one instead of silently turning every declared textarea into a
  // one-line input.
  const longText =
    meta.long_text instanceof Set ? meta.long_text : new Set(meta.long_text ?? []);
  // Manifest-declared hint for this field, if the node carries one. Undefined
  // renders an empty control, which is what every field did before this
  // existed.
  const hint = meta.field_placeholders?.[field];
  const enums = meta.valid_values?.[field];
  if (enums) {
    // Two ways a field earns the free-text overflow box, because two
    // vintages of manifest declare it differently. v2 says it once, on the
    // field itself (`allow_custom: true`), and fieldMeta's descriptor path
    // collects those names into `meta.allow_custom` -- `goals.type` is the
    // one shipped case. v1, and every hand-built `meta` in this file's own
    // test suite, has no such flag: it relies on the older convention of a
    // `custom_<field>` entry sitting in the entity's (or node's) `optional`
    // list, a magic prefix nothing declared, only relied on. Both still have
    // to work -- the first is what a converted node produces, the second is
    // everything that has not converted yet -- so this checks both rather
    // than picking one and breaking the other's callers.
    const hasCustom =
      (meta.allow_custom || []).includes(field) ||
      (meta.optional || []).includes(`custom_${field}`);
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
    return (
      <ArrayInput
        items={value || []}
        onChange={onChange}
        placeholder={hint ?? `Add ${field}…`}
      />
    );
  }
  if ((meta.bool_fields || []).includes(field)) {
    // A real JSON boolean, not the string "true". `preferences.response_format`
    // stores five of these. A missing key reads as off rather than as a third
    // state -- there is no control for "unset", and inventing one would write a
    // key the user never touched.
    return (
      <Switch
        id={id}
        checked={value === true}
        onCheckedChange={(next) => onChange(next)}
        aria-label={field.replace(/_/g, " ")}
      />
    );
  }
  if ((meta.time_fields || []).includes(field)) {
    // Same guard as date_fields below: nothing validates these on write, so an
    // MCP client can put "after midnight" into lifestyle.sleep.weekday.bedtime.
    // A picker would show that as empty and persist the emptiness on the next
    // edit, so a non-HH:MM value stays a text input -- visible and preserved.
    if (!value || HH_MM.test(value)) {
      return (
        <Input
          id={id}
          type="time"
          placeholder={hint}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="[color-scheme:light] dark:[color-scheme:dark]"
        />
      );
    }
    return (
      <Input
        id={id}
        placeholder={hint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Not an HH:MM time, so this stays a text field. Clear it to get a time picker."
      />
    );
  }
  if ((meta.date_fields || []).includes(field)) {
    // A date field is only safe to render as a picker when what is stored is
    // actually a date. Nothing validates these on write -- an MCP client can
    // put "next spring" or "Q2 2027" into goals.target_date -- and a calendar
    // has no way to show that, exactly as <input type="date"> had none: it
    // dropped any value it could not parse, showing empty and then writing the
    // emptiness back on the next edit. A value the picker cannot represent
    // therefore stays a text input: visible, editable, and preserved. Clearing
    // it hands the user the picker.
    //
    // `parseIsoDate` rather than ISO_DATE alone, which is a tightening: the
    // regex accepts 2026-02-31, and the native input quietly rolled that over
    // to March 3rd. A date that does not exist now keeps its text input too.
    if (!value || parseIsoDate(value)) {
      return (
        <DatePicker
          id={id}
          value={value || ""}
          onChange={onChange}
          placeholder={hint ?? "Pick a date"}
        />
      );
    }
    return (
      <Input
        id={id}
        placeholder={hint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Not a yyyy-mm-dd date, so this stays a text field. Clear it to get a date picker."
      />
    );
  }
  if (longText.has(field)) {
    return (
      <Textarea
        id={id}
        placeholder={hint}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
      />
    );
  }
  return (
    <Input
      id={id}
      placeholder={hint}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
