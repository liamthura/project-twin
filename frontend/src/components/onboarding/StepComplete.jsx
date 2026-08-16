/**
 * The last screen: what landed, two optional extras, and the way in.
 *
 * The extras exist because the reversed design had four field bands and this
 * one has two. Rather than lose `top_of_mind` and a goal entirely, they are
 * offered here as a one-line add -- so the flow stays short without the fields
 * disappearing.
 *
 * The one place in this slice that does not reuse a renderer. A ListRenderer
 * would bring search, badges, an add dialog and a remove confirmation to
 * collect one sentence. What it writes is identical: both entities id-assign
 * server-side, and `useListItems.addItem` appends bare objects too.
 */
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/ui/confetti";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A value someone actually gave us. An empty string is a field they passed
// over, and counting it would congratulate them for skipping.
function filledCount(value) {
  if (Array.isArray(value)) return value.length > 0 ? 1 : 0;
  if (value && typeof value === "object") {
    return Object.values(value).reduce((n, v) => n + filledCount(v), 0);
  }
  return String(value ?? "").trim() === "" ? 0 : 1;
}

function OneLineAdd({ id, label, placeholder, buttonLabel, onAdd }) {
  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText("");
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button variant="outline" onClick={submit} className="shrink-0">
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

export function StepComplete({ data, onAdd, onDone }) {
  const saved =
    filledCount(data?.profile) + filledCount(data?.preferences?.communication);

  return (
    <div className="space-y-8">
      {/* Only when something was actually saved. Confetti over an empty
          persona celebrates a job not done, and the sentence underneath it
          says so in the same breath. StrictMode double-invokes this effect in
          dev, so a fire, reset, fire flash there is expected and harmless --
          canvas-confetti guards re-entry with canvas.__confetti_initialized. */}
      {saved > 0 && <Confetti />}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h1 className="text-2xl font-semibold tracking-tight">
            That's the basics
          </h1>
        </div>
        {saved > 0 ? (
          // A NumberTicker count-up was tried here and removed: the noun is
          // picked off the final value while the ticker is still walking up
          // to it, so mid-animation frames read "1 things saved" -- the exact
          // bug this screen exists to fix, just made transient (measured
          // ~51ms at saved=3, and worse at smaller counts, which this screen
          // usually shows). The count is rendered directly instead.
          <p className="text-muted-foreground">
            {`${Intl.NumberFormat("en-GB").format(saved)} ${
              saved === 1 ? "thing" : "things"
            } saved. Everything is editable later, and an assistant can fill in the rest.`}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Nothing saved yet, which is fine. You can fill this in whenever, or
            let an assistant do it.
          </p>
        )}
      </div>

      <div className="space-y-5 rounded-lg border p-4">
        <p className="text-sm font-medium">Two more, if you want them</p>
        <OneLineAdd
          id="onboarding-top-of-mind"
          label="What is on your mind right now?"
          placeholder="e.g. finishing the migration"
          buttonLabel="Add this"
          onAdd={(value) => onAdd("projects", ["top_of_mind"], { idea: value })}
        />
        <OneLineAdd
          id="onboarding-goal"
          label="One goal you are working towards"
          placeholder="e.g. learn Rust properly"
          buttonLabel="Add goal"
          onAdd={(value) => onAdd("goals", ["goals"], { title: value })}
        />
      </div>

      <Button onClick={onDone} className="w-full sm:w-auto">
        Go to my persona
      </Button>
    </div>
  );
}
