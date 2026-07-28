import {
  Heart, ThumbsUp, ThumbsDown, Ban, Bookmark, Play, Check, X, Pause, CircleDot,
  BookOpen, Newspaper, Mic, Tv, Clapperboard, Gamepad2, Video, Music,
  Archive, Lightbulb, ArrowDown, Minus, ArrowUp, Compass,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger,
} from "@/components/ui/select";

// Enums with this many values or fewer render as a segmented control;
// larger sets render as a compact dropdown selector to save space.
// Both allow clearing (all generic enum fields are optional): segmented
// clears on active-click, the dropdown has an explicit Clear item.
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
  // likes/dislikes stance (preferences) — "like" reuses the aesthetics
  // stance entry above (same neutral thumbs-up semantics)
  dislike: { icon: ThumbsDown, tone: "text-amber-700 dark:text-amber-400",
             chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  // interest kind (lifestyle)
  passion: { icon: Heart },
  curiosity: { icon: Compass },
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
    // flex-wrap + max-w-full, not a single nowrap row. A four-option enum
    // (media.status: want / in progress / finished / dropped) needs roughly
    // 400px, but an expanded row on a 375px phone leaves about 223px once the
    // page px-4, the card's p-6 and the detail grid's px-9 are taken out --
    // so the control used to run off the side of the screen with its last
    // options unreachable. Wrapping keeps every option visible and tappable;
    // the muted pill simply grows to two rows. gap-y gives the rows air when
    // it does wrap, and costs nothing when it does not.
    <div className="inline-flex max-w-full flex-wrap gap-y-[3px] rounded-lg bg-muted p-[3px]">
      {options.map((v) => {
        const active = value === v;
        const tone = active ? VALUE_META[v]?.tone : undefined;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? undefined : v)}
            // tap-target extends the hit area by 6px without affecting
            // layout (globals.css) -- py-1 alone is a ~26px target, well
            // under what a thumb needs. Same treatment the icon buttons
            // elsewhere in the app already get.
            className={`tap-target inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm capitalize transition-colors ${FOCUS_RING} ${
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

// Sentinel for the dropdown's Clear item — Radix Select forbids "" values.
const CLEAR_SENTINEL = "__clear__";

export function SelectControl({ options, value, onChange }) {
  const isLegacy = Boolean(value) && !options.includes(value);
  const tone = value && !isLegacy ? VALUE_META[value]?.tone : undefined;
  return (
    <Select
      value={value && !isLegacy ? value : ""}
      onValueChange={(v) => onChange(v === CLEAR_SENTINEL ? undefined : v)}
    >
      <SelectTrigger
        // max-w-full so the 170px floor can never push the trigger past a
        // narrower container -- the same overflow the segmented control hit.
        className={`h-9 w-auto min-w-[170px] max-w-full gap-2 ${isLegacy ? "border-dashed" : ""}`}
        title={isLegacy ? "stored value not in the current option set" : undefined}
      >
        {value ? (
          // `!flex`, not `inline-flex`. SelectTrigger's base class carries
          // `[&>span]:line-clamp-1`, which sets display:-webkit-box plus
          // -webkit-box-orient:vertical on any direct span child -- and that
          // selector (.class > span) outranks a plain `.inline-flex`, so the
          // icon and the label were being laid out as two vertical lines with
          // the second clamped away: the icon sat on top of its own text. The
          // important flag is what actually settles the cascade here.
          // The label moves into a nested span so it can truncate; nested, it
          // is no longer a direct child, so the clamp cannot reach it either.
          <span className={`!flex min-w-0 items-center gap-1.5 capitalize ${tone || (isLegacy ? "text-muted-foreground" : "")}`}>
            <ValueIcon value={value} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{String(value).replace(/_/g, " ")}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select…</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v} value={v}>
            <span className="inline-flex items-center gap-1.5 capitalize">
              <ValueIcon value={v} className="h-3.5 w-3.5" />
              {v.replace(/_/g, " ")}
            </span>
          </SelectItem>
        ))}
        {value && (
          <>
            <SelectSeparator />
            <SelectItem value={CLEAR_SENTINEL}>
              <span className="text-muted-foreground">Clear</span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// Convenience wrapper: picks segmented-vs-chips based on option count so
// call sites don't have to.
export function EnumControl({ options, value, onChange }) {
  if (options.length > SEGMENTED_MAX) {
    // Large enums: compact dropdown (legacy values render dashed in-trigger).
    return <SelectControl options={options} value={value} onChange={onChange} />;
  }
  const isLegacy = value && !options.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isLegacy && (
        <button
          type="button"
          aria-pressed={true}
          title="stored value not in the current option set"
          onClick={() => onChange(undefined)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/50 bg-muted px-3 py-1 text-xs capitalize font-medium text-foreground transition-colors ${FOCUS_RING}`}
        >
          {String(value).replace(/_/g, " ")}
        </button>
      )}
      <SegmentedControl options={options} value={value} onChange={onChange} />
    </div>
  );
}
