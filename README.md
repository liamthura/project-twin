# Persona Manager

A full-stack application for managing your personal persona data, which integrates with the Persona MCP server for personalised LLM interactions.

## Architecture

```
persona-manager/
├── backend/          # FastAPI server (reads/writes JSON files)
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/         # React + Vite app
│   ├── src/
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## Quick Start

### 1. Set up the Backend

```bash
cd backend

# Create and configure .env
cp .env.example .env

# Edit .env to point to your persona data directory
# PERSONA_DATA_DIR=/path/to/your/persona_mcp/data

# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
```

The backend will start at `http://127.0.0.1:8000`

### 2. Set up the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run the dev server
npm run dev
```

The frontend will start at `http://localhost:3000`

### 3. Open in Browser

Navigate to `http://localhost:3000` — changes you make will be automatically saved to your JSON files.

## Features

- **Direct file editing** — Changes are written directly to your JSON files
- **Auto-save** — Debounced saving (1.5s after you stop typing)
- **Connection status** — Visual indicator showing backend connection
- **Tab-based editing** — Separate editors for each persona file
- **Array inputs** — Easy add/remove for list fields

## Configuration

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERSONA_DATA_DIR` | `./data` | Path to your persona JSON files |
| `HOST` | `127.0.0.1` | Server host |
| `PORT` | `8000` | Server port |

### Connecting to Persona MCP

Point `PERSONA_DATA_DIR` to the same `data/` folder used by your `persona_mcp` server:

```bash
# In backend/.env
PERSONA_DATA_DIR=/path/to/persona_mcp/data
```

This way, changes made in the Persona Manager UI are immediately available to the MCP server.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files` | List all files and their status |
| `GET` | `/api/files/{type}` | Get a specific file |
| `PUT` | `/api/files/{type}` | Update a specific file |
| `GET` | `/api/all` | Get all files |
| `PUT` | `/api/all` | Update multiple files |
| `POST` | `/api/reset/{type}` | Reset a file to defaults |

## Development

### Backend

```bash
cd backend
python main.py
```

API docs available at `http://127.0.0.1:8000/docs`

### Frontend

```bash
cd frontend
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production build
```

## Deployment

For local use, you can run both servers manually. For a more permanent setup:

### Option 1: Run as Services

Create systemd services or use a process manager like PM2.

### Option 2: Docker (coming soon)

A Docker Compose setup for running both services together.

### Option 3: Combined Server

Build the frontend and serve it from the FastAPI backend:

```bash
cd frontend && npm run build
# Copy dist/ to backend/static/
# Add StaticFiles mount in FastAPI
```
