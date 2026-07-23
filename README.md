# MyGist

> _Formerly "Project Twin" / "Persona MCP"_

Your portable personal context for AI — stop repeating yourself.

## Why This Exists

Every time you start a new chat with Claude, GPT, or any AI, you're a stranger again. You have to re-explain your tech stack, your preferences, your ongoing projects. MyGist solves this by giving AI access to a persistent "you" file.

## What's Inside

```
mygist/
├── backend/
│   ├── main.py          # Single entry point: REST API (/api), MCP server (/mcp), health check (/health)
│   ├── server.py        # MCP tool definitions and persona logic (imported by main.py)
│   ├── search_index.py  # Hybrid search index: per-entity FTS + optional embeddings
│   ├── embeddings.py    # Embedding providers (Voyage AI or any OpenAI-compatible endpoint)
│   ├── sections.py      # Declarative registry of persona sections
│   └── archive/         # Retired server implementations, kept for reference
├── frontend/            # React app to manually edit your persona
└── mygist_data/         # Legacy JSON persona files — migration source only
    ├── profile.json     # (data now lives in Postgres, scoped per user)
    ├── lifestyle.json   # Hobbies, values, wellness, sleep schedule
    ├── knowledge.json   # Skills, domains, mental lists
    ├── preferences.json # Code style, communication, dislikes
    └── projects.json    # Current projects, learning goals
```

Persona data is stored in Postgres (Neon in production), one JSONB blob per
`(user, file type)`. `mygist_data/` is kept only as the source for the one-off
migration (`backend/scripts/migrate_json_to_postgres.py`).

### Section packs

Persona sections are defined as **packs** — one declarative
`backend/section_packs/<key>/manifest.json` per section covering defaults,
write schema, scope contributions, search id-lists, and editor UI hints.
Packs are validated at boot (invalid packs are skipped with a warning) and
toggled per user in the Sections manager. To add a section, see
[docs/CONTRIBUTING-PACKS.md](docs/CONTRIBUTING-PACKS.md).

---

## Quick Start

### 1. Setup

MyGist is multi-user and stores persona data in Postgres, scoped per user by a
bearer token. You need a `DATABASE_URL` — a managed [Neon](https://neon.tech)
project (free tier) in production, or a local Postgres for development.

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env` (see `.env.example`):

```
# Neon pooled connection string in prod, or a local Postgres for development
DATABASE_URL=postgresql://user:pass@host/dbname
```

The server enables `pgvector` automatically on startup when the extension is
available (Neon ships it; the local test-db image too). If your Postgres
doesn't have it, everything still works — search runs in FTS-only mode (see
[Embedding search](#embedding-search-optional)).

Prefer a throwaway local database for development and tests:

```bash
cd backend && docker compose up -d test-db
# then use DATABASE_URL=postgresql://mygist:mygist@localhost:5433/mygist_test
```

### 2. Run the Server

```bash
cd backend && DATABASE_URL="<your database>" uvicorn main:app --reload
```

This starts a single process serving the REST API (`/api/*`), the MCP endpoint
(`/mcp`), and a health check (`/health`). On startup it ensures the `users` and
`persona_data` tables exist.

### 3. Create an account and get a token

Humans sign in with username + password; machines (Claude Desktop, scripts)
authenticate with named, revocable bearer tokens. Easiest path: run the
frontend and use the welcome page's **Create an account** form, then manage
API tokens from the account dialog (**Account → API tokens**).

Or via the API:

```bash
curl -X POST http://127.0.0.1:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "you", "password": "your-password"}'
# -> {"user_id": "...", "username": "you", "token": "..."}
```

Save the token — its plaintext is shown exactly once. You can create and
revoke additional named tokens any time (UI account dialog, or
`POST /api/auth/tokens`). Every read and write is scoped to the user behind
the token.

Already have JSON persona files under `mygist_data/`? Import them into your new
account in one pass (this also backfills stable entity IDs):

```bash
cd backend && DATABASE_URL="<your database>" \
  python scripts/migrate_json_to_postgres.py --username you
```

### 4. Connect to Claude Desktop

MyGist's MCP server runs over HTTP, so Claude Desktop connects to it by URL
rather than launching a local script. Pass your token as a Bearer header.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mygist": {
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

For a deployed instance, swap in your public URL (e.g. `https://mygist.thuradev.qzz.io/mcp`) instead of `127.0.0.1`.

> **Note**: The exact config keys for remote/HTTP MCP servers can vary by client version — check your client's current docs if this doesn't match what you see.

Restart Claude Desktop. Your persona tools are now available! 🎉

### 5. (Optional) Run the Frontend UI

```bash
cd frontend && npm install && npm run dev
```

---

## How to Use It

### Reading Your Persona

Just ask Claude things like:

- "What do you know about me?"
- "What are my current projects?"
- "What's my tech stack?"
- "What hobbies do I have?"
- "Remind me what I'm currently learning"

Claude will call `get_context` (or `search_context` for specific lookups) and
respond with context about you.

### Updating Your Persona

**Option 1: Ask Claude directly**

Skills & Knowledge:

> "Add Rust to my skills as something I'm learning"
> "Update my Python skill level to advanced"
> "I'm now comfortable with Docker, update that"

Projects:

> "Update my Solterra project status to completed"
> "Add a new project called 'Personal Blog' - it's a SvelteKit site"
> "Mark CBC Hackathon as finished"

Preferences & Dislikes:

> "Add 'morning meetings' to my dislikes"
> "I prefer dark mode for everything, save that"
> "Add that I like detailed explanations over brief answers"

Lifestyle:

> "Add photography as a hobby"
> "Update my sleep schedule - I sleep at 1am on weekdays"
> "Add 'after coffee' as when I'm most productive"

Personal Info:

> "Update my bio to mention I'm a full-stack developer"
> "Add that I speak Japanese at beginner level"

**Option 2: Use the UI**  
Open `http://localhost:3000` and edit your persona files directly.

**Option 3: Smart capture (experimental)**  
Tell Claude to watch for updates:

> "For this conversation, use suggest_persona_update on my messages to catch anything worth remembering"

Then chat naturally. If you say something like "I've been really getting into mechanical keyboards lately", Claude can detect that and ask if you want to add it.

### Using Your Persona in Context

Once your persona is set up, Claude can use it to personalize responses:

> "Help me write a bio for my portfolio"  
> Claude knows your skills, projects, and experience — writes a bio that actually reflects you.

> "What should I learn next?"  
> Claude sees your current skills and learning goals, suggests something that makes sense for your path.

> "I'm stuck on this Python problem"  
> Claude knows you're intermediate at Python and prefers detailed explanations.

> "Recommend some side project ideas"  
> Claude factors in your interests, current skills, and what you're learning.

---

## Important: MCP Tools Are Passive

Here's something to understand about how this works:

**Claude doesn't automatically scan your messages for persona updates.** MCP tools are passive — Claude only calls them when it decides to, or when you ask.

This means:

- Claude will read your persona when you ask about yourself
- Claude will update your persona when you explicitly ask
- Claude won't automatically detect "I started learning Rust" unless you tell it to

**To enable smart capture**, start your conversation with:

> "Call suggest_persona_update on my messages and update my persona when relevant"

Or just update manually when you want to add something.

---

## What Gets Stored

### Profile

Name, bio, location, work experience, education, languages spoken, career aspirations

### Lifestyle

Hobbies (with sub-categories and gear lists), passions, curiosities, personality traits, values, sleep schedule, energy peaks

### Knowledge

Skills/domains with proficiency levels, mental tabs (custom lists like "favorite matcha spots" or "learning resources")

### Preferences

Code style, communication preferences, learning style, response format, dislikes

### Projects

Current projects, what you're learning, top-of-mind items

### Learning Log

Insights, realizations, and conceptual learnings captured across conversations:

- Topic, details, tags
- Conversation context (what led to the insight)
- Unique IDs for tracking entries over time
- Supports conceptual learning, soft skills, and reflections (not just technical skills)

---

## Example Persona Updates

| You say                                 | What gets updated                         |
| --------------------------------------- | ----------------------------------------- |
| "I started learning Rust"               | Knowledge → Domains: Rust (learning)      |
| "I hate morning meetings"               | Preferences → Dislikes: morning meetings  |
| "I picked up photography last month"    | Lifestyle → Hobbies: Photography (active) |
| "I don't really play badminton anymore" | Lifestyle → Hobbies: Badminton (inactive) |
| "I usually sleep around 1am"            | Lifestyle → Wellness → Sleep              |
| "I'm really into mechanical keyboards"  | Lifestyle → Passions                      |
| "Just finished the Solterra project"    | Projects → Status: completed              |

---

## Smart Capture (Behind the Scenes)

When you ask Claude to analyze your messages, it uses:

**Sentiment Analysis** — Distinguishes between:

- Declarative statements ("I am a developer") → High confidence
- Insights & reflections ("This conversation helped me understand X") → High confidence, captured to learning log
- Hypotheticals ("Maybe I should try...") → Low confidence
- Venting ("Ugh, TypeScript is killing me") → Usually ignored, unless it contains insights
- Questions ("Should I learn Rust?") → Ignored unless contains real info

**Insight Detection** — Automatically captures conceptual learning and soft-skill insights:

- Direct learning: "I learned that delegation requires accountability"
- Facilitated insights: "This helped me understand pricing psychology"
- Realizations: "I realized that titles don't guarantee commitment"
- Key takeaways: "Key insight: the free tier needs to demonstrate value"
- Reflections: "Looking back, I see the pattern now"

Insights are saved to your learning log with:

- **Smart topic extraction** from conversation context ("conversation about X" → extracts X as topic)
- **Conversation context summary** (includes what led to the insight)
- **Auto-tagging** with detected concepts/skills

**Sentence-Level Analysis** — If you send a long message with a question at the end, the earlier statements still get detected.

**Confidence Scoring**:

- 0.8+ → Claude applies the update and mentions it
- 0.5-0.8 → Claude asks "Want me to remember that?"
- Below 0.5 → Ignored, no mention

**Dedupe grounding** — every capture suggestion is checked against your
existing entries via the search index: if what you mentioned already exists,
the suggestion is rewritten from "add" to an update targeting the existing
entity (or tagged with an `existing_entity` hint), so repeated mentions
don't pile up duplicates.

---

## MCP Tools Reference

| Tool                     | What it does                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `get_context`            | Scoped context bootstrap: global scopes (minimal/professional/personal/learning/full), section scopes, topic filtering, and a `detail="titles"` stub mode |
| `search_context`         | Search the persona by meaning and keywords; ranked snippets with entity ids (hybrid FTS + embeddings, or FTS-only). Optional `sections`, `limit` (≤25), `days` recency filter |
| `get_entity`             | Fetch persona entities in full by id — a single id, or a list of up to 25 (e.g. straight from `search_context` hits) |
| `get_raw`                | Raw dump of persona file(s) — export/debug use                                                 |
| `get_schema`             | Entity schema reference: valid entities, actions, and fields for writes                        |
| `persona_modify`         | Add/update/remove items (flexible field aliases). Adds that resemble an existing entry get a duplicate advisory naming it |
| `persona_batch`          | Multiple modifications in one call (per-op duplicate advisories included)                      |
| `suggest_persona_update` | Analyze a message for potential updates, dedupe-checked against existing entries — suggestions for content you already have are rewritten to updates targeting the existing entity |

The lean-retrieval pattern AI clients are steered toward: `search_context`
(find, ~10 small ranked snippets) → `get_entity` (full detail for just the
hits that matter), instead of pulling whole sections.

### Scoped Context (`get_context`)

Control how much data Claude loads based on the task:

| Scope          | Tokens | Includes                                       |
| -------------- | ------ | ---------------------------------------------- |
| `minimal`      | ~150   | Name, bio, location, current role, top of mind |
| `professional` | ~3600  | Work, skills, projects, domains                |
| `personal`     | ~1400  | Hobbies, values, personality, wellness         |
| `learning`     | ~3400  | Domains, current learning, goals               |
| `full`         | ~8000  | Everything                                     |

**Section scopes**: any section key (`profile`, `knowledge`, `projects`,
`lifestyle`, `circle`, `learning_log`, `preferences`) works as a scope, alone
or in a list — `get_context(scope=["lifestyle", "circle"])`.

**Topic filtering**: Add `topic="Python"` to keep only relevant entries.
This runs through the search index (semantic matching in hybrid mode, ranked
keyword matching otherwise — no more hardcoded alias lists).

```
get_context(scope="professional", topic="Python")  # ~245 tokens instead of 3600
```

**Titles mode**: `detail="titles"` swaps every list entry for an
`{id, title}` stub — on a real persona that cut a professional scope from
~7,100 to ~1,600 tokens. Skim the stubs, then `get_entity` the ones you need.

### Batch Operations (`persona_batch`)

Run multiple updates in a single call:

```json
{
  "operations": [
    {
      "action": "add",
      "entity": "domain",
      "data": { "name": "Rust", "level": "learning" }
    },
    {
      "action": "update",
      "entity": "project",
      "data": { "name": "Blog", "status": "active" }
    },
    {
      "action": "add",
      "entity": "work_highlight",
      "data": {
        "company": "Acme",
        "highlights": ["Led team of 5", "Shipped v2.0"]
      }
    }
  ]
}
```

### Supported Entities

Call `get_schema()` for the authoritative, always-current list (entities,
actions, required/optional fields, examples). A sampler:

| Entity                 | Actions             | Key Fields                                                                |
| ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| `domain`               | add, update, remove | name, level, tags                                                         |
| `project`              | add, update, remove | name, status, tags, description                                           |
| `hobby`                | add, update, remove | name, skill_level, status (active/inactive), notes, specifics, references |
| `work_experience`      | add, update, remove | role, company, type, period, highlights                                   |
| `work_highlight`       | add, remove         | company, highlight (or highlights[])                                      |
| `project_highlight`    | add, remove         | project_name, highlight (or highlights[])                                 |
| `hobby_reference`      | add, remove         | hobby_name, ref_name, url, notes                                          |
| `domain_reference`     | add, remove         | domain_name, ref_name, url, notes                                         |
| `project_reference`    | add, remove         | project_name, ref_name, url, notes                                        |
| `mental_tab_reference` | add, remove         | title (mental tab), ref_name, url, notes                                  |
| `top_of_mind`          | add, remove         | item/idea, note                                                           |
| `current_learning`     | add, remove         | topic                                                                     |
| `dislike`              | add, remove         | item                                                                      |
| `value`                | add, remove         | value                                                                     |
| `passion`              | add, remove         | passion                                                                   |
| `learning_entry`       | add, remove         | topic, details, tags, source (optional)                                   |
| And more...            |                     |                                                                           |

---

## Embedding search (optional)

`search_context` and `get_entity` let Claude search your persona by meaning
and keywords instead of loading whole sections. By default this runs in
**FTS-only mode** (Postgres full-text search, keyword matching) — no setup
required. Adding an embedding provider upgrades it to **hybrid mode** (FTS +
vector similarity), which also catches paraphrases and related concepts, not
just keyword matches.

> **Note:** Hybrid mode requires the [pgvector](https://github.com/pgvector/pgvector)
> extension. Neon supports it out of the box. A self-hosted vanilla Postgres
> without the extension automatically falls back to FTS-only — nothing
> breaks, you just lose semantic matching.

Configure one of two providers via environment variables (`.env` supported):

| Variable             | Required for       | Description                                                                 |
| --------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `EMBEDDING_PROVIDER`  | either provider     | `voyage` (default) or `openai`                                                |
| `VOYAGE_API_KEY`      | `voyage`             | API key for hosted [Voyage AI](https://www.voyageai.com/) embeddings          |
| `EMBEDDING_API_URL`   | `openai`             | Base URL of an OpenAI-compatible `/v1/embeddings` endpoint (Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, or OpenAI itself) |
| `EMBEDDING_API_KEY`   | `openai` (optional)  | API key for the endpoint above; omit for local servers that don't require one |
| `EMBEDDING_MODEL`     | optional             | Embedding model name (default: `voyage-4-lite`, 200M free tokens/month)                             |
| `EMBEDDING_DIM`       | optional             | Vector dimension the `embedding` column is created at (default: `1024`); must match your model's output dimension |

Leaving `EMBEDDING_PROVIDER`/`VOYAGE_API_KEY`/`EMBEDDING_API_URL` unset keeps
the server in FTS-only mode.

`search_context` also accepts a `days` argument to only return entries
changed in the last N days (per-entry, in either mode) — note that a full
backfill with `--recreate` (below) resets every entry's last-change time, so
`days` will look empty right after one until entries change again.

### Backfilling the search index

New entities are indexed automatically as you write them. To (re)index
everything that already exists — e.g. after enabling an embedding provider
for the first time, or changing `EMBEDDING_MODEL`/`EMBEDDING_DIM` — run the
backfill script from `backend/`:

```bash
python scripts/backfill_search_index.py             # index missing/changed entities
python scripts/backfill_search_index.py --recreate  # drop + recreate the embedding
                                                      # column at EMBEDDING_DIM, then
                                                      # re-embed everything
```

Use `--recreate` whenever `EMBEDDING_DIM` changes (e.g. switching models) —
the existing `embedding` column is at the old dimension and must be rebuilt.
It reads `DATABASE_URL` and the `EMBEDDING_*` vars the same way the server
does (`.env` supported).

After a dim-mismatch boot (the server logged a `WARNING: persona_search.embedding
is vector(N) but EMBEDDING_DIM=M` and fell back to FTS-only), running
`--recreate` is not enough by itself: **also restart the server process**. The
already-running server cached `VECTOR_AVAILABLE = False` at startup and stays
FTS-only until it reboots and re-runs `ensure_schema()`, even though the
column backfill has since fixed the dimension mismatch.

---

## Roadmap

- [x] Core persona read/write
- [x] Smart context capture with sentiment analysis
- [x] Insight detection for learning log (conceptual learning, soft skills, reflections)
- [x] Smart topic extraction from conversation context
- [x] Distinction between venting and reflection
- [x] Sentence-level analysis for compound messages
- [x] Scoped context retrieval (minimal/professional/personal/learning/full)
- [x] Topic-based filtering for focused context
- [x] Batch operations for multiple updates
- [x] Hobby status tracking (active/inactive)
- [x] Flexible field aliases across all entities
- [x] Learning log with unique IDs and conversation context
- [x] Multi-user Postgres storage with password sign-in + revocable API tokens
- [x] Per-user section enable/disable
- [x] Web UI: persona editor with account/token management, mobile-friendly
- [x] Export/import (account dialog → Data)
- [x] Hybrid search (Postgres FTS + pgvector embeddings, Voyage or local models)
- [x] Lean retrieval tools (`search_context` + `get_entity`) and titles-only context mode
- [x] Duplicate advisories and dedupe-grounded capture suggestions
- [ ] Better auto-triggering (waiting on MCP improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning

---

## License

TBD – Currently private
