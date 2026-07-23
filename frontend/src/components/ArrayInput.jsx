import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
          onKeyPress={(e) =>
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
