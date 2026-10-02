/**
 * The last screen on the typing path: what you added, two optional extras, and
 * the way in.
 *
 * The extras exist because the reversed design had four field bands and this
 * one has two. Rather than lose `top_of_mind` and a goal entirely, they are
 * offered here as a one-line add -- so the flow stays short without the fields
 * disappearing.
 *
 * The count is `added` from OnboardingFlow's countAdded: what you typed in this
 * flow. It used to count every filled value, so the British English default
 * the server writes into a new persona was congratulated as something you
 * saved. The confetti moved to your first approval in Review, the moment the
 * assistant path ends on.
 *
 * The one place in this slice that does not reuse a renderer. A ListRenderer
 * would bring search, badges, an add dialog and a remove confirmation to
 * collect one sentence. What it writes is identical: both entities id-assign
 * server-side, and `useListItems.addItem` appends bare objects too.
 */
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atStart } from "@/lib/watchtower.js";

function OneLineAdd({ id, label, placeholder, buttonLabel, place, onAdd }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(false);
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText("");
    setAdded(true);
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setAdded(false);
          }}
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
      {/* "Add this" used to clear the field and say nothing. */}
      {added && (
        <p role="status" className="animate-in fade-in text-sm text-muted-foreground motion-reduce:animate-none">
          Added to {place}
        </p>
      )}
    </div>
  );
}

export function StepComplete({ added, report, onAdd, onDone }) {
  const connection = report?.connection;
  const things = `${added} ${added === 1 ? "thing" : "things"}`;
  const line =
    added === 0
      ? "Nothing added yet. Fill it in whenever you like, or let an assistant do it."
      : connection?.state === "connected"
        ? `You've added ${things}. ${atStart(connection.name)} can read them now.`
        : `You've added ${things}. Connect an assistant and it can read them and suggest the rest.`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">That&apos;s the basics</h1>
        </div>
        <p className="max-w-prose text-muted-foreground">{line}</p>
      </div>

      <div className="space-y-5 rounded-lg border p-4">
        <p className="text-sm font-medium">Two more, if you like</p>
        <OneLineAdd
          id="onboarding-top-of-mind"
          label="What's on your mind at the moment?"
          placeholder="e.g. finishing the migration"
          buttonLabel="Add this"
          place="Top of mind"
          onAdd={(value) => onAdd("projects", ["top_of_mind"], { idea: value })}
        />
        <OneLineAdd
          id="onboarding-goal"
          label="A goal you're working towards"
          placeholder="e.g. learn Rust properly"
          buttonLabel="Add goal"
          place="Goals"
          onAdd={(value) => onAdd("goals", ["goals"], { title: value })}
        />
      </div>

      <Button onClick={onDone} className="w-full sm:w-auto">
        Go to my persona
      </Button>
    </div>
  );
}
