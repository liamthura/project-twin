# Project Twin

A personal digital twin that stores who you are — your skills, preferences, projects, and quirks — so AI assistants can actually remember you across conversations.

## Why This Exists

Every time you start a new chat with Claude, GPT, or any AI, you're a stranger again. You have to re-explain your tech stack, your preferences, your ongoing projects. Project Twin solves this by giving AI access to a persistent "you" file.

## What's Inside

```
project-twin/
├── backend/
│   ├── mcp_server.py    # MCP server for Claude Desktop (or any LLM tool that support MCP)
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

Claude will call `get_persona` and respond with context about you.

### Updating Your Persona

**Option 1: Ask Claude directly**
> "Add Rust to my skills as something I'm learning"
> "Update my Solterra project status to completed"
> "Add 'morning meetings' to my dislikes"

**Option 2: Use the UI**  
Open `http://localhost:3000` and edit your persona files directly.

**Option 3: Smart capture (experimental)**  
Tell Claude to watch for updates:
> "For this conversation, use suggest_persona_update on my messages to catch anything worth remembering"

Then chat naturally. If you say something like "I've been really getting into mechanical keyboards lately", Claude can detect that and ask if you want to add it.

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

| You say | What gets updated |
|---------|-------------------|
| "I started learning Rust" | Knowledge → Domains: Rust (learning) |
| "I hate morning meetings" | Preferences → Dislikes: morning meetings |
| "I picked up photography last month" | Lifestyle → Hobbies: Photography |
| "I usually sleep around 1am" | Lifestyle → Wellness → Sleep |
| "I'm really into mechanical keyboards" | Lifestyle → Passions |
| "Just finished the Solterra project" | Projects → Status: completed |

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

| Tool | What it does |
|------|--------------|
| `get_persona` | Get all your data at once |
| `get_profile` | Just your identity/work/education |
| `get_lifestyle` | Hobbies, passions, values, wellness |
| `get_knowledge` | Skills and mental tabs |
| `get_preferences` | Code style, communication, dislikes |
| `get_projects` | Current projects and learning goals |
| `persona_update` | Update a single field |
| `persona_modify` | Add/update/remove multiple items |
| `suggest_persona_update` | Analyze a message for potential updates |

---

## Roadmap

- [x] Core persona read/write
- [x] Smart context capture with sentiment analysis
- [x] Sentence-level analysis for compound messages
- [ ] Better auto-triggering (waiting on MCP improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning
- [ ] Export/import

---

## License

TBD – Currently private
