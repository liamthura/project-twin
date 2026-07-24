import {
  Heart, ThumbsUp, ThumbsDown, Ban, Bookmark, Play, Check, X, Pause, CircleDot,
  BookOpen, Newspaper, Mic, Tv, Clapperboard, Gamepad2, Video, Music,
  Archive, Lightbulb, ArrowDown, Minus, ArrowUp,
} from "lucide-react";

// Enums with this many values or fewer render as a segmented control;
// larger sets render as wrapping chip radios. Clicking the active choice
// clears it (all generic enum fields are optional).
export const SEGMENTED_MAX = 4;

// Semantic icon + color pairing for well-known enum values, so state reads
// at a glance. Accessibility rule: color is never the only signal — every
// value keeps its text label and gains an icon; tints meet AA in both themes.
//
// Skill/knowledge level values (beginner/learning/intermediate/advanced/
// expert) and language proficiency (native/fluent/conversational/basic)
// are intentionally NOT given entries here — "learning" collides with the
// goal TYPE value, and levels are progressions rather than statuses, so
// they stay plain (no icon, default active styling).
export const VALUE_META = {
  // aesthetics stance
  love: { icon: Heart, tone: "text-rose-600 dark:text-rose-400",
          chip: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
  like: { icon: ThumbsUp },
  avoid: { icon: Ban, tone: "text-amber-700 dark:text-amber-400",
           chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  // media reaction (taste signal, mirrors stance semantics)
  loved: { icon: Heart, tone: "text-rose-600 dark:text-rose-400",
           chip: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
  liked: { icon: ThumbsUp },
  disliked: { icon: ThumbsDown, tone: "text-amber-700 dark:text-amber-400",
              chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  // media + goal status
  want: { icon: Bookmark },
  in_progress: { icon: Play },
  finished: { icon: Check, tone: "text-emerald-700 dark:text-emerald-400",
              chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  achieved: { icon: Check, tone: "text-emerald-700 dark:text-emerald-400",
              chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  active: { icon: CircleDot, tone: "text-emerald-700 dark:text-emerald-400",
            chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  paused: { icon: Pause, tone: "text-amber-700 dark:text-amber-400",
            chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  dropped: { icon: X },
  // media kinds (icon only — categorical, no status semantics)
  book: { icon: BookOpen },
  article: { icon: Newspaper },
  podcast: { icon: Mic },
  show: { icon: Tv },
  film: { icon: Clapperboard },
  game: { icon: Gamepad2 },
  video: { icon: Video },
  music: { icon: Music },
  // lifecycle statuses (hobbies, mental tabs, projects)
  inactive: { icon: X },
  completed: { icon: Check, tone: "text-emerald-700 dark:text-emerald-400",
               chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  archived: { icon: Archive },
  open: { icon: CircleDot, tone: "text-emerald-700 dark:text-emerald-400",
          chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  closed: { icon: Check },
  idea: { icon: Lightbulb },
  // priority
  low: { icon: ArrowDown },
  medium: { icon: Minus },
  high: { icon: ArrowUp, tone: "text-amber-700 dark:text-amber-400",
          chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
};

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

export function ValueIcon({ value, className }) {
  const Icon = VALUE_META[value]?.icon;
  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-[3px]">
      {options.map((v) => {
        const active = value === v;
        const tone = active ? VALUE_META[v]?.tone : undefined;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : v)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm capitalize transition-colors ${FOCUS_RING} ${
              active
                ? `bg-background font-medium shadow-sm ${tone || "text-foreground"}`
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ValueIcon value={v} className="h-3.5 w-3.5" />
            {v.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

export function ChipRadioGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const active = value === v;
        const chip = active ? VALUE_META[v]?.chip : undefined;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : v)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs capitalize transition-colors ${FOCUS_RING} ${
              active
                ? chip || "border-primary bg-accent font-medium text-accent-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <ValueIcon value={v} className="h-3 w-3" />
            {v.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

// Convenience wrapper: picks segmented-vs-chips based on option count so
// call sites don't have to.
export function EnumControl({ options, value, onChange }) {
  const Control = options.length <= SEGMENTED_MAX ? SegmentedControl : ChipRadioGroup;
  return <Control options={options} value={value} onChange={onChange} />;
}
