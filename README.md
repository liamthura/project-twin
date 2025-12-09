# Project Twin

A personal digital twin that stores who you are — your skills, preferences, projects, and quirks — so AI assistants can actually remember you across conversations.

## Why This Exists

Every time you start a new chat with Claude, GPT, or any AI, you're a stranger again. You have to re-explain your tech stack, your preferences, your ongoing projects. Project Twin solves this by giving AI access to a persistent "you" file.

## What's Inside

```
project-twin/
├── backend/
│   ├── mcp_server.py    # MCP server for Claude Desktop (or any LLM tool that supports MCP)
│   └── main.py          # FastAPI server for the UI
├── frontend/            # React app to manually edit your persona
└── persona_mcp/data/    # Your persona files (JSON)
    ├── profile.json     # Name, bio, work, education
    ├── lifestyle.json   # Hobbies, values, wellness, sleep schedule
    ├── knowledge.json   # Skills, domains, mental lists
    ├── preferences.json # Code style, communication, dislikes
    └── projects.json    # Current projects, learning goals
```

---

## Quick Start

### 1. Setup

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### 2. Connect to Claude Desktop

#### macOS

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "persona": {
      "command": "/path/to/project-twin/backend/venv/bin/python",
      "args": ["/path/to/project-twin/backend/mcp_server.py"]
    }
  }
}
```

#### Windows

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "persona": {
      "command": "C:\\path\\to\\project-twin\\backend\\venv\\Scripts\\python.exe",
      "args": ["C:\\path\\to\\project-twin\\backend\\mcp_server.py"]
    }
  }
}
```

> **Note**: Use double backslashes (`\\`) in the JSON paths, or forward slashes (`/`) which also work on Windows.

Restart Claude Desktop. Your persona tools are now available! 🎉

### 3. (Optional) Run the UI

```bash
# Backend
cd backend && uvicorn main:app --reload

# Frontend
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
- Hypotheticals ("Maybe I should try...") → Low confidence
- Venting ("Ugh, TypeScript is killing me") → Usually ignored
- Questions ("Should I learn Rust?") → Ignored unless contains real info

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
| `persona_modify`         | Add/update/remove items (flexible field aliases)                                               |
| `persona_batch`          | Multiple modifications in one call                                                             |
| `suggest_persona_update` | Analyze a message for potential updates                                                        |

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

| Entity             | Actions             | Key Fields                                                                |
| ------------------ | ------------------- | ------------------------------------------------------------------------- |
| `skill`            | add, update, remove | name, level                                                               |
| `domain`           | add, update, remove | name, level, tags                                                         |
| `project`          | add, update, remove | name, status, tags, description                                           |
| `hobby`            | add, update, remove | name, skill_level, status (active/inactive), notes, specifics, references |
| `work_experience`  | add, update, remove | role, company, type, period, highlights                                   |
| `work_highlight`   | add, remove         | company, highlight (or highlights[])                                      |
| `top_of_mind`      | add, remove         | item/idea, note                                                           |
| `current_learning` | add, remove         | topic                                                                     |
| `dislike`          | add, remove         | item                                                                      |
| `value`            | add, remove         | value                                                                     |
| `passion`          | add, remove         | passion                                                                   |
| And more...        |                     |                                                                           |

---

## Roadmap

- [x] Core persona read/write
- [x] Smart context capture with sentiment analysis
- [x] Sentence-level analysis for compound messages
- [x] Scoped context retrieval (minimal/professional/personal/learning/full)
- [x] Topic-based filtering for focused context
- [x] Batch operations for multiple updates
- [x] Hobby status tracking (active/inactive)
- [x] Flexible field aliases across all entities
- [ ] Better auto-triggering (waiting on MCP improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning
- [ ] Export/import

---

## License

TBD – Currently private
