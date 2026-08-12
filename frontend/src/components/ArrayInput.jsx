import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// A paste that carries a delimiter is a LIST of values; one that does not is a
// value the user is still writing, so it falls through to the browser's paste
// and stays editable. That fall-through is what makes it safe to commit every
// piece of a delimited paste rather than withholding the last one: pasting a
// finished list is the common case, and holding its last item back put an extra
// Enter in the way of it.
//
// No dedupe: addItem does not dedupe on Enter, and doing it on one route only is
// how the two would come to disagree.
const DELIMITED = /[,\n]/;

// Array Input Component
export function ArrayInput({ items = [], onChange, placeholder }) {
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const removeItem = (index) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text");
    if (!DELIMITED.test(text)) return;
    e.preventDefault();

    const pieces = text.split(DELIMITED).map((s) => s.trim()).filter(Boolean);
    // Anything already typed becomes the first value rather than being discarded:
    // the input is about to be cleared, so leaving it out would silently lose it.
    const lead = newItem.trim();
    const additions = lead ? [lead, ...pieces] : pieces;

    if (additions.length > 0) onChange([...items, ...additions]);
    setNewItem("");
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <Badge key={index} variant="secondary" className="gap-1 pr-1">
              {item}
              <button
                onClick={() => removeItem(index)}
                className="ml-1 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), addItem())
          }
          placeholder={placeholder}
          className="flex-1"
        />
        <Button onClick={addItem} size="sm" variant="secondary">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
