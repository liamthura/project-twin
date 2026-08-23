/**
 * The bento tile visuals.
 *
 * Markup, not screenshots. Two reasons, both learned the hard way on this
 * branch:
 *
 *   1. A baked PNG is light-mode pixels. The design spec records the
 *      consequence -- "a dark landing frame would show light UI inside every
 *      bento tile". These inherit the theme.
 *   2. Every one of these visuals was invented from imagination on the first
 *      pass and every one was wrong: search scores off by ~30x, four skill
 *      files that do not exist, a consent screen with per-section checkboxes,
 *      a manifest key that is not in the schema, and a container image that
 *      was never published, on the wrong port.
 *
 * So: every component below names the file it is checked against, and the
 * strings come from that file. The demo persona is Maya Ellis throughout --
 * never the owner's own account.
 */
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mark } from "./Brand";

/** The panel a mini-UI sits on. Oversized on purpose: it bleeds out of the
 *  tile and gets clipped, which is what the diagonal fade is for. */
function Surface({ className, children }) {
  return (
    <div
      className={cn(
        "w-[520px] min-h-[280px] overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Row({ title, sub, right }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
        {sub ? (
          <p className="truncate text-[12px] text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

/**
 * Scoped reads — the scope payload.
 * Source: backend/section_packs/preferences/manifest.json (title, description
 * and the code_style field's three keys), backend/server.py get_context.
 */
export function ScopePayload() {
  return (
    <div className="w-[520px] min-h-[280px]">
      <p className="mb-3 font-mono text-[12px] text-foreground">
        SCOPE: professional
      </p>
      <Surface>
        <div className="divide-y divide-border">
          <Row title="Preferences" sub="Communication style, code style, likes and dislikes" />
          <Row title="Code Style" sub="Your preferred programming languages, frameworks, and tools" />
          <Row title="Preferred Languages" sub="Python · TypeScript · SQL" />
          <Row title="Projects" sub="What you are working on right now" />
        </div>
      </Surface>
    </div>
  );
}

/**
 * Search — a search_context call over ranked results.
 * Source: backend/search_index.py. Scores are reciprocal rank fusion,
 * 1/(RRF_K + rank) with RRF_K = 60, summed across the full-text and vector
 * legs. So a result ranked first by both legs scores 1/61 + 1/61 = 0.033, and
 * one found by a single leg scores about 0.016. They live between 0.01 and
 * 0.04 -- the first draft of this visual showed 0.94.
 */
export function SearchResults() {
  const results = [
    { section: "preferences", score: "0.033", title: "Communication", snippet: "Short paragraphs. No bullet lists unless I ask for one." },
    { section: "preferences", score: "0.016", title: "Likes and dislikes", snippet: "Dislikes hedging and filler openers." },
    { section: "profile", score: "0.016", title: "Role", snippet: "Backend engineer, mostly Python and Postgres." },
  ];

  return (
    <div className="w-[520px] min-h-[280px]">
      <p className="mb-3 font-mono text-[12px] text-link">
        search_context("how does Maya like replies written")
      </p>
      <Surface>
        <div className="divide-y divide-border">
          {results.map((r) => (
            <div key={r.title} className="px-4 py-2.5">
              <p className="flex items-baseline gap-2 text-[12px]">
                <span className="font-mono text-muted-foreground">{r.section}</span>
                <span className="font-mono text-link">{r.score}</span>
                <span className="text-[13px] font-medium text-foreground">{r.title}</span>
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {r.snippet}
              </p>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}

/**
 * Your sections — the ten packs, plus the manifest that adds an eleventh.
 * Source: backend/section_packs/*//*manifest.json, in `position` order.
 */
const SECTIONS = [
  "Profile", "Goals", "Knowledge", "Preferences", "Projects",
  "Lifestyle", "Media", "Aesthetics", "Circle", "Learning Log",
];

export function SectionChips() {
  return (
    <div className="w-[520px] min-h-[280px]">
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((name) => (
          <span
            key={name}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground"
          >
            {name}
          </span>
        ))}
        <span className="rounded-full border border-dashed border-border px-3 py-1.5 text-[13px] text-muted-foreground">
          + Recipes
        </span>
      </div>
      <pre className="mt-4 overflow-hidden rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`{
  "key": "recipes",
  "title": "Recipes",
  "position": 80
}`}
      </pre>
    </div>
  );
}

/**
 * Proposals — a pending proposal.
 * Source: backend/proposals_store.py and backend/scopes.py (propose_update is
 * the PROPOSE scope's only tool; nothing it produces applies on its own).
 */
export function ProposalCard() {
  return (
    <Surface>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground">
          Claude
        </span>
        <span className="text-[13px] text-muted-foreground">proposed a change</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-[14px]">
          <span className="font-semibold text-foreground">Update</span>{" "}
          <span className="text-muted-foreground">project</span>
        </p>
        <dl className="mt-2 space-y-1 text-[12px]">
          <div className="flex gap-3">
            <dt className="w-12 shrink-0 text-muted-foreground">name</dt>
            <dd className="truncate text-foreground">Monthly newsletter</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-12 shrink-0 text-muted-foreground">notes</dt>
            <dd className="truncate text-foreground">
              Maya owns this end to end from June.
            </dd>
          </div>
        </dl>
        <p className="mt-3 border-l-2 border-border pl-3 text-[12px] italic text-muted-foreground">
          "I've taken the newsletter over from Dan."
        </p>
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-2.5">
        <span className="rounded-md bg-primary px-3 py-1 text-[12px] text-primary-foreground">
          Approve
        </span>
        <span className="rounded-md border border-border px-3 py-1 text-[12px] text-foreground">
          Reject
        </span>
      </div>
    </Surface>
  );
}

/**
 * Consent — the three OAuth scope switches.
 * Source: frontend/src/components/Consent.jsx. Labels and help text are that
 * file's, verbatim. There is no per-section choice on the real screen, which
 * is what the first draft of this visual invented.
 */
export function ConsentPanel() {
  const scopes = [
    { label: "Read your persona", help: "Always granted. A connection needs this to do anything.", on: true, locked: true },
    { label: "Suggest changes for your approval", help: "Changes wait for you to approve them before they apply.", on: true },
    { label: "Change your persona directly", help: "Applied immediately, without asking first.", on: false },
  ];

  return (
    <Surface>
      <div className="px-4 py-3">
        <p className="text-[14px] text-foreground">
          <span className="font-semibold">Claude</span> wants to connect
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Signing in as maya</p>
      </div>
      <div className="space-y-3 border-t border-border px-4 py-3">
        {scopes.map((scope) => (
          <div key={scope.label} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{scope.label}</p>
              <p className="truncate text-[12px] text-muted-foreground">{scope.help}</p>
            </div>
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5",
                scope.on ? "bg-primary" : "bg-muted-foreground/30",
                scope.locked && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 rounded-full bg-white transition-transform",
                  scope.on && "translate-x-4",
                )}
              />
            </span>
          </div>
        ))}
      </div>
    </Surface>
  );
}

/**
 * Skills — the four guides that ship with MyGist.
 * Source: skills/*//*SKILL.md. These are the real four; the first draft of this
 * visual listed read-persona.md and three other files that do not exist.
 */
const SKILLS = [
  { name: "mygist", sub: "The three rules governing reading, writing and proposing" },
  { name: "mygist-reading", sub: "Choosing a scope, and searching instead of dumping" },
  { name: "mygist-writing", sub: "Which write tool is correct, and what advisories mean" },
  { name: "mygist-capture", sub: "What is worth proposing, and what is not" },
];

export function SkillsList() {
  return (
    <div className="w-[520px] min-h-[280px]">
      <p className="mb-3 font-mono text-[12px] text-muted-foreground">
        skills/
      </p>
      <Surface>
        <div className="divide-y divide-border">
          {SKILLS.map((skill) => (
            <Row key={skill.name} title={skill.name} sub={skill.sub} />
          ))}
        </div>
      </Surface>
    </div>
  );
}

/**
 * Run it yourself — the quick start.
 * Source: README.md lines 54-55 and the Dockerfile. Port 1120, and the image
 * is built locally: there is no published registry image, which the first
 * draft of this visual invented on the wrong port.
 *
 * Fixed dark colours rather than tokens: a terminal is dark in both modes.
 */
export function Terminal() {
  return (
    <div className="w-[520px] min-h-[280px] overflow-hidden rounded-lg border border-white/10 bg-[#1C1917]">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
      </div>
      <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed text-[#FBF0EE]">
<span className="text-[#FF9DC5]">$</span> docker build -t mygist .{"\n"}
<span className="text-[#FF9DC5]">$</span> docker run -p 1120:1120 \{"\n"}
{"    "}-e DATABASE_URL="postgresql://…" mygist
      </pre>
    </div>
  );
}

/**
 * The hero pair, left: the editor, on Preferences.
 *
 * Preferences rather than Profile, and that reverses a call this file used to
 * make the other way. The old hero shot argued "Profile rather than
 * Preferences because Profile is the section that explains what a persona
 * *is* to someone who has never seen one", which was right while the mockup
 * stood alone. It stopped being right when the mockup became half of a pair:
 * the pair has to tell ONE story -- the tone rule you type here is the tone
 * rule that comes out over there -- and a six-field identity panel tells a
 * different, unrelated one. What a persona *is* is now carried by the frame
 * next door, which shows one being used, and by the bento.
 *
 * Source: backend/section_packs/preferences/manifest.json. The panel
 * description is that file's `description` verbatim; "Communication" is its
 * group title; and tone / detail level / locale are the three keys under
 * `communication.default`, in the manifest's own order. `locale` really does
 * default to "British English" there.
 *
 * Fluid, unlike every mock in this file that feeds a bento tile. Those are
 * fixed at 520px and bleed out of their tile on purpose. This one lives in a
 * frame whose height is set by the frame's aspect ratio, so a fixed inner
 * width is exactly how the old hero shot ended up showing a phone visitor the
 * left 60% of a panel with "Maya Ellis" sliced through the middle.
 */
export function PreferencesMock() {
  const fields = [
    ["Tone", "Short. No exclamation marks."],
    ["Detail level", "The answer first, then why."],
    ["Locale", "British English"],
  ];

  return (
    <div className="flex h-full flex-col bg-background text-left">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
        <span className="flex items-center gap-1.5">
          <Mark className="h-3.5 w-3.5 text-primary" />
          <span className="font-display text-[13px] font-semibold tracking-tight">
            MyGist
          </span>
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">Saved</span>
          <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
            Maya
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 p-3 sm:p-4">
        <p className="text-[13px] font-semibold text-foreground sm:text-[15px]">
          Preferences
        </p>
        {/* The manifest's `description` used to sit here. It is gone on
            purpose: the frame's height is fixed by the Safari aspect ratio at
            277px on desktop and 199px on a phone, and with that line in place
            the third field was clipped through the middle at both. Cutting
            the line that repeats what the fields below already show is the
            honest way to fit; shrinking the type until it fits is not. */}
        <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Communication
        </p>

        <dl className="mt-1.5 space-y-1.5">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] text-muted-foreground sm:text-[11px]">
                {label}
              </dt>
              <dd className="mt-0.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground sm:text-[13px]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * The hero pair, right: an assistant reading that persona.
 *
 * **Deliberately not any client's chrome.** No window furniture, no product
 * name, no mark. This follows the rule
 * `docs-site/public/screenshots/README.md` already set for the `chat-*`
 * figures: "No chat client ships with this project, and faking one client's
 * chrome would be both misleading and somebody else's trademark, so the frame
 * is drawn -- deliberately plain". The same file describes how the tool call
 * should read: "collapsed to one row with the tool name, a query chip and a
 * check".
 *
 * Sources for what it claims:
 *   - `get_context` and its `scope` argument: backend/server.py:3020.
 *   - `minimal` returning preferences: backend/server.py:2993, and the
 *     always-on rule at :2999 -- "a section scope returns that whole section
 *     plus the always-on preferences (tone, detail_level, likes_dislikes,
 *     learning_style)". That is why a tone rule comes back on a scope the
 *     assistant picked for an unrelated question, which is the whole point of
 *     the pair.
 *   - Maya, the newsletter, and her tone: mini.jsx PreferencesMock and the
 *     demo persona used throughout this file.
 */
export function AssistantMock() {
  return (
    <div className="flex h-full flex-col gap-2.5 bg-card p-3 text-left sm:gap-3 sm:p-4">
      <p className="text-[11px] text-muted-foreground sm:text-[12px]">
        Draft a reply to the Northgate newsletter feedback.
      </p>

      {/* The tool call, collapsed the way a client renders one. */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="font-mono text-[10px] text-foreground sm:text-[11px]">
          get_context
        </span>
        <span className="truncate rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          scope: minimal
        </span>
        <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />
      </div>

      {/* Four lines, not two. The frame is height-matched to the editor beside
          it, and a two-line reply left roughly 130px of empty card under it --
          which reads as a broken screenshot rather than as breathing room. The
          honest way to fill a frame is more of the thing it is showing. */}
      <div className="space-y-1.5 text-[11px] leading-relaxed text-foreground sm:space-y-2 sm:text-[13px]">
        <p>
          Thanks for reading, and for taking the time to write. You are right
          that the June issue ran long.
        </p>
        <p>
          We are cutting it back this month: one lead story, two short notes,
          and the events list moves to the site. If it still runs over, tell
          me and I will trim it again.
        </p>
      </div>

      <p className="mt-auto border-t border-border pt-2 text-[10px] text-muted-foreground sm:text-[11px]">
        Short, British spelling, no exclamation marks — from your Preferences,
        which every scope returns.
      </p>
    </div>
  );
}

/** Tile id -> visual. Keyed by the same ids as content.js. */
export const TILE_MEDIA = {
  "scoped-reads": ScopePayload,
  search: SearchResults,
  sections: SectionChips,
  proposals: ProposalCard,
  consent: ConsentPanel,
  skills: SkillsList,
  "self-host": Terminal,
};
