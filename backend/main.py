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
VALID_FILES = ["profile", "knowledge", "preferences", "projects", "interests", "learning_log"]

# Default data structures
DEFAULTS = {
    "profile": {
        "name": "",
        "current_role": "",
        "organisation": "",
        "location": "",
        "languages_spoken": [],
        "bio": "",
        "contact": {"email": "", "github": ""}
    },
    "knowledge": {
        "domains": []
    },
    "preferences": {
        "code_style": {
            "preferred_languages": [],
            "frameworks": [],
            "tools": []
        },
        "communication": {
            "tone": "",
            "detail_level": "",
            "locale": "British English"
        },
        "learning_style": {
            "preferred": [],
            "avoid": []
        }
    },
    "projects": {
        "projects": [],
        "current_learning": [],
        "top_of_mind": []
    },
    "interests": {
        "hobbies": [],
        "passions": [],
        "curiosities": []
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
                return json.load(f)
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
