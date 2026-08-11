// A node whose stored value is a bare `string[]` -- lifestyle's `values` and
// `personality_traits`, preferences' `code_style` lists, profile's `highlights`.
//
// There are no per-item fields and, for most of these, no entity at all: what
// is stored is the string, not an object with a key. So unlike ListRenderer
// this takes no `entity` and builds no field meta.
//
// Two presentations, chosen by `control`, because the retired editors used both
// and the difference is not cosmetic:
//
//   "chips" (default) -- ArrayInput's chips. Right for short, word-like values
//     you add and remove but never revise: "integrity", "Python", "Docker".
//     Editing means deleting and retyping, which is cheap for one word.
//
//   "input" -- one editable row per string. Right for sentence-like values
//     where a typo means retyping the whole thing: profile's work and
//     education highlights ("Reduced processing time by 40%"). ProfileEditor
//     rendered these as editable rows for exactly that reason, and binding
//     them as chips was a real loss of function, not just of styling.
//
// `control` sits on the NODE for a top-level `strings` node and on the FIELD for
// an array-valued field rendered as a block under a row -- the same key, the
// same meaning, and `blockNode` carries the field's copy onto the node it builds
// so this file only ever has one place to look. v1 spelled the node-level key
// `item_control` and its default "tag"; v2 spells the default "chips", which is
// what ArrayInput actually renders, and no shipped pack declares it (all five
// declarations are "input"), so nothing depends on the old spelling.
import { Plus, Trash2 } from "lucide-react";

import { ArrayInput } from "@/components/ArrayInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// "Values" -> "value", "Personality Traits" -> "personality trait". Only used
// when a node declares no `placeholder`. The rule is deliberately naive --
// trailing "s" only -- because it runs on manifest titles, which are authored,
// not on arbitrary input. A title where it reads wrong is a signal to write the
// placeholder out, not to grow a pluralisation library.
function singular(node) {
  const label = (node.title ?? "item").toLowerCase().replace(/_/g, " ");
  return label.endsWith("s") ? label.slice(0, -1) : label;
}

export function StringsRenderer({ node, items, onItems }) {
  // A path that has never been written reads back as undefined, and a stored
  // value can be any shape an MCP client left behind. Either way this renders
  // an empty, usable list rather than throwing.
  const list = Array.isArray(items) ? items : [];

  // `node.description` is deliberately NOT rendered here: SectionRenderer draws
  // it under the node's heading, for every kind.
  if (node.control !== "input") {
    return (
      <ArrayInput
        items={list}
        onChange={onItems}
        placeholder={node.placeholder ?? `Add ${singular(node)}...`}
      />
    );
  }

  // Rows are keyed by index, not by value: the value IS what the user is
  // typing, so keying on it would remount the input on every keystroke and
  // drop focus after one character.
  const setAt = (i, value) => onItems(list.map((s, j) => (j === i ? value : s)));
  const removeAt = (i) => onItems(list.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {list.map((value, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input
            value={typeof value === "string" ? value : String(value ?? "")}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={node.placeholder ?? `A ${singular(node)}...`}
            aria-label={`${singular(node)} ${i + 1}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="tap-target h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${singular(node)} ${i + 1}`}
            onClick={() => removeAt(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {/* Appends an empty string and lets the user type into it, rather than
          opening a dialog: these are one-line values and the row is already
          the editor. */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-full border-dashed"
        onClick={() => onItems([...list, ""])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add {singular(node)}
      </Button>
    </div>
  );
}
