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

# Persona data + auth now live in Postgres (see db.py / persona_store.py).
import db
import persona_store
from persona_store import VALID_FILES, DEFAULTS

# Aliases keep every existing route body -- read_json_file(file_type) /
# write_json_file(file_type, data) -- byte-for-byte unchanged.
read_json_file = persona_store.load
write_json_file = persona_store.save

# Import MCP server
from server import mcp

# Create MCP HTTP app. Default path is "/mcp" - FastMCP registers this as an
# exact route internally, so mounting the whole app at "/" below lets "/mcp"
# resolve directly (no trailing-slash redirect, unlike mounting at "/mcp" with
# an internal path of "/", which required a "/mcp/" -> would 307 on "/mcp").
mcp_app = mcp.http_app()

# Initialize FastAPI
app = FastAPI(title="MyGist API", version="1.0.0", lifespan=mcp_app.lifespan)

# Ensure the users / persona_data tables exist before serving requests.
db.ensure_schema()

# Bearer auth middleware for /mcp and /api routes
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Public routes (no auth required)
    if path in ("/health", "/healthz", "/api/health", "/api/auth/register"):
        return await call_next(request)

    # Protected routes: /mcp/* and /api/* -- resolve the bearer token to a user
    # and scope the request to them via the current_user_id contextvar.
    if path.startswith("/mcp") or path.startswith("/api"):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        user = db.resolve_token(auth[7:])
        if not user:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        db.current_user_id.set(user["id"])
        request.state.username = user["username"]

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

class FileUpdate(BaseModel):
    """Request body for updating a file."""
    data: Dict[str, Any]


# ============================================================================
# API Routes
# ============================================================================

@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for container orchestration."""
    return {"status": "ok", "service": "mygist"}


# ============================================================================
# Auth: self-serve token registration, whoami, rotate
# ============================================================================

class RegisterRequest(BaseModel):
    username: str


@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    try:
        user_id, token = db.create_user(username)
    except db.DuplicateUsernameError:
        raise HTTPException(status_code=409, detail="username already taken")
    return {"user_id": user_id, "username": username, "token": token}


@app.get("/api/auth/whoami")
async def whoami(request: Request):
    return {"user_id": db.current_user_id.get(), "username": request.state.username}


@app.post("/api/auth/rotate")
async def rotate(request: Request):
    new_token = db.rotate_token(db.current_user_id.get())
    return {"token": new_token}


@app.get("/api/files")
async def list_files():
    """List persona file types and whether the current user has data for them."""
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select file_type from persona_data where user_id = %s", (user_id,)
        ).fetchall()
    existing = {row["file_type"] for row in rows}
    return {"files": {ft: {"exists": ft in existing} for ft in VALID_FILES}}


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
    print(f"Database: {'configured' if os.getenv('DATABASE_URL') else 'MISSING DATABASE_URL'}")
    print(f"Server: http://{host}:{port}")
    
    uvicorn.run(app, host=host, port=port)
