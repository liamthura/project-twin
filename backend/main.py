"""
MyGist API + MCP Server

Single entry point serving:
- REST API at /api/*
- MCP server at /mcp
- Health check at /health
"""

import json
import os
import secrets
import sys
import zipfile
import io
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
def resolve_data_dir() -> Path:
    base_dir = Path(__file__).parent
    env_dir = os.getenv("PERSONA_DATA_DIR")
    if env_dir:
        candidate = Path(env_dir).expanduser()
        if not candidate.is_absolute():
            candidate = (base_dir / candidate).resolve()
    else:
        candidate = base_dir.parent / "mygist_data"
    return candidate


DATA_DIR = resolve_data_dir()
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    print(f"Warning: could not create data directory {DATA_DIR}: {exc}", file=sys.stderr)

# Import MCP server
from server import mcp

# Create MCP HTTP app. Default path is "/mcp" - FastMCP registers this as an
# exact route internally, so mounting the whole app at "/" below lets "/mcp"
# resolve directly (no trailing-slash redirect, unlike mounting at "/mcp" with
# an internal path of "/", which required a "/mcp/" -> would 307 on "/mcp").
mcp_app = mcp.http_app()

# Initialize FastAPI
app = FastAPI(title="MyGist API", version="1.0.0", lifespan=mcp_app.lifespan)

# Bearer auth middleware for /mcp and /api routes
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    
    # Public routes (no auth required)
    if path in ("/health", "/healthz"):
        return await call_next(request)
    
    # Protected routes: /mcp/* and /api/*
    if path.startswith("/mcp") or path.startswith("/api"):
        token = os.getenv("MYGIST_API_TOKEN")
        if token:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or not secrets.compare_digest(auth[7:], token):
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    return await call_next(request)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://mygist.thuradev.qzz.io",
        "http://localhost:1120",
        "http://chat.orb.local"
        "http://147.79.18.20",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}

# Valid file types
VALID_FILES = ["profile", "knowledge", "preferences", "projects", "lifestyle", "circle", "learning_log"]

# Default data structures
DEFAULTS = {
    "profile": {
        "name": "",
        "preferred_name": "",
        "current_role": "",
        "organisation": "",
        "location": "",
        "nationality": "",
        "languages_spoken": [],
        "bio": "",
        "work_experience": [],
        "career_aspirations": [],
        "education": [],
        "goals_and_careers": [],
        "contact": {
            "emails": [],
            "links": []
        }
    },
    "knowledge": {
        "domains": [],
        "mental_tabs": []
    },
    "preferences": {
        "code_style": {
            "preferred_languages": [],
            "frameworks": [],
            "tools": []
        },
        "communication": {
            "default": {
                "tone": "",
                "detail_level": "",
                "locale": "British English"
            },
            "mood_overrides": []
        },
        "learning_style": {
            "preferred": [],
            "avoid": []
        },
        "dislikes": []
    },
    "projects": {
            "projects": [],
        "current_learning": [],
        "top_of_mind": []
    },
    "lifestyle": {
        "hobbies": [],
        "passions": [],
        "curiosities": [],
        "personality_traits": [],
        "values": [],
        "wellness": {
            "sleep": {
                "weekday": {"bedtime": "", "wakeup": ""},
                "weekend": {"bedtime": "", "wakeup": ""}
            },
            "energy_peaks": [],
            "stress_triggers": []
        }
    },
    "circle": {
        "connections": []
    },
    "learning_log": {
        "entries": []
    }
}


class FileUpdate(BaseModel):
    """Request body for updating a file."""
    data: Dict[str, Any]


def get_file_path(file_type: str) -> Path:
    """Get the full path for a file type."""
    if file_type not in VALID_FILES:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {file_type}")
    return DATA_DIR / f"{file_type}.json"


def read_json_file(file_type: str) -> Dict[str, Any]:
    """Read a JSON file, returning default if it doesn't exist.

    Includes migration logic for legacy data formats. Current data (as of Dec 2025)
    is already migrated, but this serves as safety net for backups/imports.
    """
    filepath = get_file_path(file_type)
    if filepath.exists():
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Normalize legacy profile language entries (strings -> objects with fluency)
                if file_type == "profile":
                    languages = data.get("languages_spoken", [])
                    if languages and isinstance(languages[0], str):
                        data["languages_spoken"] = [
                            {"name": lang, "fluency": "conversational"}
                            for lang in languages
                        ]
                    
                    # Migrate education from object to array if needed
                    education = data.get("education", {})
                    if isinstance(education, dict) and education:
                        # Old format was a single education object
                        data["education"] = [{
                            "institution": education.get("university", ""),
                            "degree_level": education.get("degree_level", ""),
                            "field_of_study": education.get("major", ""),
                            "start_year": "",
                            "end_year": education.get("graduation_year", ""),
                            "status": "completed",
                            "coursework": education.get("coursework", []),
                            "clubs": education.get("clubs", []),
                            "highlights": [],
                        }]
                    elif isinstance(education, list):
                        # Ensure all education entries have highlights field
                        for edu in education:
                            if isinstance(edu, dict):
                                edu.setdefault("highlights", [])
                    else:
                        data["education"] = []
                    
                    # Ensure goals_and_careers is at profile level
                    if isinstance(education, dict) and education.get("goals_and_careers"):
                        data.setdefault("goals_and_careers", education["goals_and_careers"])
                    data.setdefault("goals_and_careers", [])
                    
                    contact = data.get("contact", {})
                    # Convert single email string -> emails array
                    if isinstance(contact, dict):
                        email_value = contact.get("email")
                        if email_value and not contact.get("emails"):
                            contact["emails"] = [{
                                "address": email_value,
                                "purpose": "primary"
                            }]
                            contact.pop("email", None)

                        # Ensure emails list exists
                        contact.setdefault("emails", [])

                        # Normalize links if stored as list of strings
                        links = contact.get("links", [])
                        if links and isinstance(links, list) and links and isinstance(links[0], str):
                            contact["links"] = [
                                {"label": f"Link {i+1}", "url": url}
                                for i, url in enumerate(links)
                            ]

                        contact.setdefault("links", [])
                        data["contact"] = contact
                if file_type == "projects":
                    projects = data.get("projects", [])
                    if isinstance(projects, list):
                        for project in projects:
                            if isinstance(project, dict):
                                # migrate legacy tech_stack -> tags
                                if "tags" not in project and "tech_stack" in project:
                                    project["tags"] = project.get("tech_stack", [])
                                    project.pop("tech_stack", None)
                                project.setdefault("tags", [])
                                project.setdefault("references", [])
                                project.setdefault("notes", "")
                                project.setdefault("highlights", [])
                if file_type == "knowledge":
                    domains = data.get("domains", [])
                    if isinstance(domains, list):
                        for domain in domains:
                            if isinstance(domain, dict):
                                domain.setdefault("references", [])
                    mental_tabs = data.get("mental_tabs", [])
                    if isinstance(mental_tabs, list):
                        for tab in mental_tabs:
                            if isinstance(tab, dict):
                                tab.setdefault("references", [])
                if file_type == "preferences":
                    if isinstance(data, dict):
                        data.setdefault("dislikes", [])
                        # Migrate old flat communication structure to new nested structure
                        if "communication" in data:
                            comm = data["communication"]
                            # Check if it's the old flat format (has "tone" at top level but no "default")
                            if isinstance(comm, dict) and "tone" in comm and "default" not in comm:
                                # Migrate to new nested format
                                data["communication"] = {
                                    "default": {
                                        "tone": comm.get("tone", ""),
                                        "detail_level": comm.get("detail_level", ""),
                                        "locale": comm.get("locale", "British English")
                                    },
                                    "mood_overrides": []
                                }
                        else:
                            data["communication"] = DEFAULTS["preferences"]["communication"]
                if file_type == "lifestyle":
                    if isinstance(data, dict):
                        data.setdefault("wellness", {
                            "sleep": {
                                "weekday": {"bedtime": "", "wakeup": ""},
                                "weekend": {"bedtime": "", "wakeup": ""}
                            },
                            "energy_peaks": [],
                            "stress_triggers": []
                        })
                if file_type == "learning_log":
                    # Migrate existing entries to enhanced schema with IDs
                    entries = data.get("entries", [])
                    if isinstance(entries, list):
                        import uuid
                        from datetime import datetime as dt
                        for entry in entries:
                            if isinstance(entry, dict):
                                # Add ID if missing (for cross-referencing)
                                if "id" not in entry:
                                    # Generate ID from timestamp or index
                                    ts = entry.get("timestamp", "")
                                    if ts:
                                        try:
                                            date_part = ts[:10].replace("-", "")
                                        except:
                                            date_part = dt.now().strftime("%Y%m%d")
                                    else:
                                        date_part = dt.now().strftime("%Y%m%d")
                                    entry["id"] = f"learn_{date_part}_{uuid.uuid4().hex[:6]}"
                                # Ensure optional fields have proper defaults when accessed
                                # (don't add empty fields to keep data clean)
                return data
        except json.JSONDecodeError:
            return DEFAULTS.get(file_type, {})
    return DEFAULTS.get(file_type, {})


def write_json_file(file_type: str, data: Dict[str, Any]) -> None:
    """Write data to a JSON file."""
    filepath = get_file_path(file_type)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ============================================================================
# API Routes
# ============================================================================

@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for container orchestration."""
    return {
        "status": "ok",
        "service": "mygist",
        "data_dir": str(DATA_DIR.absolute()),
        "data_dir_exists": DATA_DIR.exists()
    }


@app.get("/api/files")
async def list_files():
    """List all available persona files and their status."""
    files = {}
    for file_type in VALID_FILES:
        filepath = get_file_path(file_type)
        files[file_type] = {
            "exists": filepath.exists(),
            "path": str(filepath)
        }
    return {"files": files, "data_dir": str(DATA_DIR.absolute())}


@app.get("/api/files/{file_type}")
async def get_file(file_type: str):
    """Get the contents of a specific persona file."""
    data = read_json_file(file_type)
    return {"file_type": file_type, "data": data}


@app.put("/api/files/{file_type}")
async def update_file(file_type: str, update: FileUpdate):
    """Update a specific persona file."""
    write_json_file(file_type, update.data)
    return {"status": "saved", "file_type": file_type}


@app.get("/api/all")
async def get_all_files():
    """Get all persona files in one request."""
    all_data = {}
    for file_type in VALID_FILES:
        all_data[file_type] = read_json_file(file_type)
    return {"data": all_data}


@app.put("/api/all")
async def update_all_files(updates: Dict[str, Dict[str, Any]]):
    """Update multiple persona files at once."""
    saved = []
    for file_type, data in updates.items():
        if file_type in VALID_FILES:
            write_json_file(file_type, data)
            saved.append(file_type)
    return {"status": "saved", "files": saved}


@app.post("/api/reset/{file_type}")
async def reset_file(file_type: str):
    """Reset a file to its default state."""
    if file_type not in DEFAULTS:
        raise HTTPException(status_code=400, detail=f"No default for: {file_type}")
    write_json_file(file_type, DEFAULTS[file_type])
    return {"status": "reset", "file_type": file_type}


# ============================================================================
# Backup & Restore
# ============================================================================

@app.get("/api/export")
async def export_data():
    """Export all MyGist data as a downloadable zip file."""
    if not DATA_DIR.exists():
        raise HTTPException(status_code=404, detail="Data directory not found")
    
    # Create zip in memory
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add all JSON files from DATA_DIR
        for json_file in DATA_DIR.glob("*.json"):
            zf.write(json_file, json_file.name)
        
        # Add metadata
        metadata = {
            "exported_at": datetime.now().isoformat(),
            "version": "1.0.0",
            "files": [f.name for f in DATA_DIR.glob("*.json")]
        }
        zf.writestr("_metadata.json", json.dumps(metadata, indent=2))
    
    zip_buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"mygist_backup_{timestamp}.zip"
    
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


def deep_merge(existing: dict, incoming: dict) -> dict:
    """Deep merge two dicts. Arrays are concatenated (with dedup for objects with 'id')."""
    result = existing.copy()
    
    for key, incoming_val in incoming.items():
        if key not in result:
            result[key] = incoming_val
        elif isinstance(result[key], dict) and isinstance(incoming_val, dict):
            result[key] = deep_merge(result[key], incoming_val)
        elif isinstance(result[key], list) and isinstance(incoming_val, list):
            # Merge arrays - dedupe by 'id' if objects have it
            existing_list = result[key]
            existing_ids = {item.get('id') for item in existing_list if isinstance(item, dict) and 'id' in item}
            
            for item in incoming_val:
                if isinstance(item, dict) and 'id' in item:
                    if item['id'] not in existing_ids:
                        existing_list.append(item)
                        existing_ids.add(item['id'])
                elif item not in existing_list:  # Simple values - avoid duplicates
                    existing_list.append(item)
            result[key] = existing_list
        else:
            # Scalar values - incoming overwrites
            result[key] = incoming_val
    
    return result


@app.post("/api/import")
async def import_data(file: UploadFile = File(...), mode: str = "replace"):
    """
    Import MyGist data from an uploaded zip file.
    
    mode: "replace" (default) - replaces existing files
          "merge" - merges with existing data (arrays concatenated, objects merged)
    """
    if mode not in ("replace", "merge"):
        raise HTTPException(status_code=400, detail="Mode must be 'replace' or 'merge'")
    
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")
    
    zip_data = await file.read()
    
    try:
        zip_buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            # Security check: only allow .json files
            for name in zf.namelist():
                if not name.endswith('.json'):
                    continue
                if '..' in name or name.startswith('/'):
                    raise HTTPException(status_code=400, detail=f"Invalid filename: {name}")
            
            # Create backup of current data
            backup_dir = DATA_DIR.parent / f"mygist_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            if DATA_DIR.exists() and any(DATA_DIR.glob("*.json")):
                shutil.copytree(DATA_DIR, backup_dir)
            
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            
            imported_files = []
            for name in zf.namelist():
                if name.endswith('.json') and not name.startswith('_'):
                    file_path = DATA_DIR / name
                    
                    if mode == "merge" and file_path.exists():
                        # Merge mode: combine with existing
                        existing_data = json.loads(file_path.read_text())
                        incoming_data = json.loads(zf.read(name))
                        merged_data = deep_merge(existing_data, incoming_data)
                        file_path.write_text(json.dumps(merged_data, indent=2))
                    else:
                        # Replace mode: overwrite
                        zf.extract(name, DATA_DIR)
                    
                    imported_files.append(name)
            
            return {
                "status": "success",
                "mode": mode,
                "imported_files": imported_files,
                "backup_created": str(backup_dir) if backup_dir.exists() else None
            }
            
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")


# ============================================================================
# Mount MCP app
# ============================================================================
# Mounted at root (not "/mcp") and registered last so the /api and /health
# routes above take precedence - the MCP app itself already owns the exact
# "/mcp" route internally.
app.mount("/", mcp_app)


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    
    print(f"Starting MyGist API...")
    print(f"Data directory: {DATA_DIR.absolute()}")
    print(f"Server: http://{host}:{port}")
    
    uvicorn.run(app, host=host, port=port)
