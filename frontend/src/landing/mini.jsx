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
import { cn } from "@/lib/utils";

/** The panel a mini-UI sits on. Oversized on purpose: it bleeds out of the
 *  tile and gets clipped, which is what the diagonal fade is for. */
function Surface({ className, children }) {
  return (
    <div
      className={cn(
        "w-[520px] overflow-hidden rounded-lg border border-border bg-card",
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
    <div className="w-[520px]">
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
    <div className="w-[520px]">
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
    <div className="w-[520px]">
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
    { label: "Read your persona", help: "Always granted — a connection needs this to do anything.", on: true, locked: true },
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
    <div className="w-[520px]">
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
    <div className="w-[520px] overflow-hidden rounded-lg border border-white/10 bg-[#1C1917]">
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
 * The hero mockup: the editor, with Maya's Preferences open.
 *
 * Source: the app itself -- the section rail is the pack list in `position`
 * order (backend/section_packs/*//*manifest.json) and the open section's fields
 * are the four keys in the preferences pack's `defaults`.
 *
 * Unlike the tile visuals this fills its container rather than bleeding, since
 * it sits inside browser chrome in the hero.
 */
export function EditorMock() {
  const fields = [
    { label: "Tone", value: "Direct. Say the thing, then the reason." },
    { label: "Detail level", value: "Short paragraphs, no bullet lists unless asked" },
    { label: "Locale", value: "British English" },
  ];

  return (
    <div className="flex min-h-[320px] text-left">
      <nav className="hidden w-[190px] shrink-0 border-r border-border p-3 sm:block">
        <ul className="space-y-0.5">
          {SECTIONS.map((name) => (
            <li key={name}>
              <span
                className={cn(
                  "block rounded-md px-3 py-1.5 text-[13px]",
                  name === "Preferences"
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {name}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 p-5 sm:p-6">
        <p className="text-[13px] text-muted-foreground">Maya Ellis</p>
        <h3 className="mt-0.5 text-lg font-semibold text-foreground">Preferences</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Communication style, code style, likes and dislikes
        </p>

        <div className="mt-5 space-y-3">
          {fields.map((field) => (
            <div key={field.label}>
              <p className="text-[12px] text-muted-foreground">{field.label}</p>
              <div className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground">
                {field.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {["Python", "TypeScript", "SQL"].map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
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
