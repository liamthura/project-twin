"""
Persona Manager Backend

FastAPI server that provides CRUD operations for persona JSON files.
Reads and writes directly to the data directory.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
DATA_DIR = Path(os.getenv("PERSONA_DATA_DIR", "./data"))

# Ensure data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Initialize FastAPI
app = FastAPI(
    title="Persona Manager API",
    description="API for managing personal persona data files",
    version="1.0.0"
)

# Import and register persona routes
from persona_routes import router as persona_router
app.include_router(persona_router)

# CORS configuration for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Valid file types
VALID_FILES = ["profile", "knowledge", "preferences", "projects", "lifestyle", "learning_log"]

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
    """Read a JSON file, returning default if it doesn't exist."""
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

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Persona Manager API",
        "data_dir": str(DATA_DIR.absolute())
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
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    
    print(f"Starting Persona Manager API...")
    print(f"Data directory: {DATA_DIR.absolute()}")
    print(f"Server: http://{host}:{port}")
    
    uvicorn.run(app, host=host, port=port)
