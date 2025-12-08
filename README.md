# Project Twin

A personal digital twin system that stores your identity, knowledge, preferences, and projects — making them accessible to LLMs for truly personalized AI interactions.

## What is This?

Project Twin consists of three parts:

1. **Persona MCP Server** — A Model Context Protocol server that exposes your persona data as tools for Claude, Perplexity, and other LLM clients
2. **Persona Manager UI** — A React app for manually viewing/editing your persona data
3. **JSON Data Store** — Structured files containing everything about you

```
project-twin/
├── backend/
│   ├── main.py              # FastAPI server for the UI
│   ├── mcp_server.py        # MCP server for LLM integration ⭐
│   ├── persona_routes.py    # API routes
│   └── requirements.txt
├── frontend/                 # React + Vite + Tailwind UI
│   ├── src/
│   │   ├── App.jsx          # Main editor UI
│   │   └── components/ui/   # shadcn/ui components
│   └── package.json
└── persona_mcp/
    └── data/                 # Your persona JSON files
        ├── profile.json      # Identity, contact, work, education
        ├── interests.json    # Hobbies, passions, values, traits
        ├── knowledge.json    # Skills/domains, mental tabs (lists)
        ├── preferences.json  # Code style, communication, dislikes
        ├── projects.json     # Current projects, learning, focus
        └── learning_log.json # Timestamped learnings from convos
```

## Quick Start

### 1. Backend Setup

```bash
cd backend

# Create virtual environment (recommended)
python -m venv venv && source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "PERSONA_DATA_DIR=../persona_mcp/data" > .env

# Run the FastAPI server (for UI)
uvicorn main:app --reload
```

Backend runs at `http://127.0.0.1:8000` (API docs at `/docs`)

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`

### 3. MCP Server Setup (for LLM Integration)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "persona": {
      "command": "python",
      "args": ["/path/to/project-twin/backend/mcp_server.py"]
    }
  }
}
```

Restart Claude Desktop and your persona tools will be available! 🎉

---

## MCP Server Tools

The MCP server provides **9 tools** for reading and modifying persona data:

### Read Tools (7)

| Tool               | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `get_persona`      | Get ALL persona data at once (best for initial context)    |
| `get_profile`      | Identity, contact, languages, education, work experience   |
| `get_interests`    | Hobbies, passions, curiosities, values, personality traits |
| `get_knowledge`    | Skills/domains, mental tabs with references                |
| `get_preferences`  | Code style, communication, learning style, dislikes        |
| `get_projects`     | Projects, current learning, top of mind focus items        |
| `get_learning_log` | Timestamped entries of things learned in conversations     |

### Write Tools (2)

| Tool             | Description                                    |
| ---------------- | ---------------------------------------------- |
| `persona_update` | Update a single field via dot-notation path    |
| `persona_modify` | Add/update/remove items from any data category |

### Key Features

- **Flexible Field Names** — LLMs can use `hobby`, `name`, `activity`, or `hobby_name` interchangeably
- **Decision Routing** — Tool descriptions include detailed guides on where data should go
- **Mental Tabs** — Track lists of things (matcha spots, restaurants, resources) with nested references

### Data Routing Examples

```
"I started photography"        → ADD hobby {name: "Photography"}
"Add street photography focus" → ADD hobby_specific {hobby_name, specific}
"Add this matcha spot"         → UPDATE mental_tab_reference notes
"I don't like meetings"        → ADD dislike {dislike: "meetings"}
"I'm learning Rust"            → ADD domain {name: "Rust", level: "learning"}
"Working on Solterra now"      → UPDATE project {name: "Solterra", status: "active"}
```

---

## Data Structure

### Profile (`profile.json`)

```
├── name, bio, location, nationality
├── contact: { emails[], links[] }
├── languages_spoken[]: { name, fluency }
├── education[]: { institution, degree_level, field_of_study, highlights[] }
├── work_experience[]: { role, company, type, period, highlights[] }
└── career_aspirations[]
```

### Interests (`interests.json`)

```
├── hobbies[]:
│   ├── name, skill_level, notes
│   ├── specifics[]: sub-categories (e.g., "street photography")
│   └── references[]: { name, url, notes } (gear, tutorials)
├── passions[]: deep interests
├── curiosities[]: things exploring
├── personality_traits[]
└── values[]
```

### Knowledge (`knowledge.json`)

```
├── domains[]:
│   ├── name, level (learning/intermediate/advanced), notes
│   └── references[]: docs, courses, resources
└── mental_tabs[]:
    ├── title, content (general notes), tags[], status
    └── references[]: ← THE ACTUAL LISTS LIVE HERE
        ├── name: section identifier
        └── notes: the items/places/resources
```

### Preferences (`preferences.json`)

```
├── code_style: { languages, frameworks, tools, conventions }
├── communication: { tone, detail_level, locale, avoid[], preferences[] }
├── learning_style: { preferred[], avoid[] }
├── response_format
├── work_preferences
└── dislikes[]: things to avoid in responses
```

### Projects (`projects.json`)

```
├── projects[]:
│   ├── name, description, status, notes
│   ├── tags[]
│   └── references[]
├── current_learning[]: { topic, context, priority }
└── top_of_mind[]: current focus items
```

### Learning Log (`learning_log.json`)

```
└── entries[]: { timestamp, topic, details, source, tags[] }
```

---

## UI Features

- **Tab-based editing** — Separate editors for each persona file
- **Auto-save** — Debounced saving (1.5s after you stop typing)
- **Connection status** — Visual indicator showing backend connection
- **Array inputs** — Easy add/remove for list fields
- **Mental tab editor** — Nested references for list tracking

---

## API Endpoints (FastAPI)

| Method | Endpoint            | Description                     |
| ------ | ------------------- | ------------------------------- |
| `GET`  | `/api/files`        | List all files and their status |
| `GET`  | `/api/files/{type}` | Get a specific file             |
| `PUT`  | `/api/files/{type}` | Update a specific file          |
| `GET`  | `/api/all`          | Get all files                   |
| `PUT`  | `/api/all`          | Update multiple files           |
| `POST` | `/api/reset/{type}` | Reset a file to defaults        |

---

## Development

### Running Everything

```bash
# Terminal 1: Backend
cd backend && source venv/bin/activate && uvicorn main:app --reload

# Terminal 2: Frontend
cd frontend && npm run dev
```

### Testing MCP Server Locally

```bash
cd backend
python mcp_server.py
# Server runs on stdio - use with Claude Desktop or MCP inspector
```

---

## Environment Variables

| Variable           | Default               | Description                |
| ------------------ | --------------------- | -------------------------- |
| `PERSONA_DATA_DIR` | `../persona_mcp/data` | Path to persona JSON files |

---

## Roadmap

- [ ] Better Context Awareness
- [ ] Data versioning/history
- [ ] Export/import functionality
- [ ] Token optimization when data grows

---

## License

TBD – Currently private
