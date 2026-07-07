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

On a Neon project, enable `pgvector` once — it's unused today but avoids a
future migration when embedding-search is added:

```sql
create extension if not exists vector;
```

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

### 3. Get a token

Auth is token-only — a token *is* the credential (no passwords). Register a
username to receive one, exactly once:

```bash
curl -X POST http://127.0.0.1:8000/api/auth/register \
  -H "Content-Type: application/json" -d '{"username": "you"}'
# -> {"user_id": "...", "username": "you", "token": "..."}
```

…or use the frontend's **Create an account** button (Server Connection dialog).
Save the token — it isn't shown again. Rotate later with
`POST /api/auth/rotate`. Every read and write is scoped to the user behind the
token.

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

Claude will call `get_persona` and respond with context about you.

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

- 0.5+ → Claude applies the update and mentions it
- 0.4-0.5 → Claude asks "Want me to remember that?"
- Below 0.4 → Ignored, no mention

---

## MCP Tools Reference

| Tool                     | What it does                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `get_persona`            | Get all your data at once                                                                      |
| `get_context`            | Get scoped context (minimal/professional/personal/learning/full) with optional topic filtering |
| `get_profile`            | Just your identity/work/education                                                              |
| `get_lifestyle`          | Hobbies, passions, values, wellness                                                            |
| `get_knowledge`          | Skills and mental tabs                                                                         |
| `get_preferences`        | Code style, communication, dislikes                                                            |
| `get_projects`           | Current projects and learning goals                                                            |
| `get_learning_log`       | Insights and conceptual learnings captured over time                                           |
| `persona_modify`         | Add/update/remove items (flexible field aliases)                                               |
| `persona_batch`          | Multiple modifications in one call                                                             |
| `suggest_persona_update` | Analyze a message for potential updates (includes insight detection for learning log)          |

### Scoped Context (`get_context`)

Control how much data Claude loads based on the task:

| Scope          | Tokens | Includes                                       |
| -------------- | ------ | ---------------------------------------------- |
| `minimal`      | ~150   | Name, bio, location, current role, top of mind |
| `professional` | ~3600  | Work, skills, projects, domains                |
| `personal`     | ~1400  | Hobbies, values, personality, wellness         |
| `learning`     | ~3400  | Domains, current learning, goals               |
| `full`         | ~8000  | Everything                                     |

**Topic filtering**: Add `topic="Python"` to narrow results to matching items only.

```
get_context(scope="professional", topic="Python")  # ~245 tokens instead of 3600
```

### Batch Operations (`persona_batch`)

Run multiple updates in a single call:

```json
{
  "operations": [
    {
      "action": "add",
      "entity": "skill",
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

| Entity                 | Actions             | Key Fields                                                                |
| ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| `skill`                | add, update, remove | name, level                                                               |
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
- [ ] Better auto-triggering (waiting on MCP improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning
- [ ] Export/import

---

## License

TBD – Currently private
