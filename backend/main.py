"""
MyGist API + MCP Server

Single entry point serving:
- REST API at /api/*
- MCP server at /mcp
- Health check at /health
"""

import copy
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
import sections
import settings_store
from persona_store import VALID_FILES

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
    if path in ("/health", "/healthz", "/api/health", "/api/auth/register", "/api/auth/login"):
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
# Auth: register, login, whoami, set-password, token management
# ============================================================================

MIN_PASSWORD_LENGTH = 8


def validate_new_password(password: str) -> None:
    """Shared length rules for any password being set (register/set-password).
    Login deliberately skips this: oversized passwords there are treated as an
    ordinary failed login (see db.verify_password) to avoid an oracle."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if len(password.encode("utf-8")) > db.MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at most {db.MAX_PASSWORD_BYTES} bytes",
        )


class RegisterRequest(BaseModel):
    username: str
    password: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class SetPasswordRequest(BaseModel):
    password: str
    current_password: Optional[str] = None


class CreateTokenRequest(BaseModel):
    label: str = "token"


@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if body.password is not None:
        validate_new_password(body.password)
    try:
        user_id, token = db.create_user(username, body.password)
    except db.DuplicateUsernameError:
        raise HTTPException(status_code=409, detail="username already taken")
    return {"user_id": user_id, "username": username, "token": token}


@app.post("/api/auth/login")
async def login(body: LoginRequest):
    try:
        user = db.verify_password(body.username, body.password)
    except db.PasswordNotSetError:
        raise HTTPException(
            status_code=401, detail="password sign-in not set up for this account"
        )
    if user is None:
        # Same body for unknown username and wrong password: never reveal
        # whether the account exists.
        raise HTTPException(status_code=401, detail="invalid username or password")
    _, token = db.create_token(user["id"], "web")
    return {"user_id": user["id"], "username": user["username"], "token": token}


@app.get("/api/auth/whoami")
async def whoami(request: Request):
    return {"user_id": db.current_user_id.get(), "username": request.state.username}


@app.post("/api/auth/set-password")
async def set_password(body: SetPasswordRequest):
    validate_new_password(body.password)
    try:
        db.set_password(db.current_user_id.get(), body.password, body.current_password)
    except db.InvalidCredentialsError:
        raise HTTPException(status_code=403, detail="current password is incorrect")
    return {"status": "ok"}


@app.get("/api/auth/tokens")
async def list_tokens():
    return {"tokens": db.list_tokens(db.current_user_id.get())}


@app.post("/api/auth/tokens")
async def create_token(body: CreateTokenRequest):
    label = body.label.strip() or "token"
    token_id, token = db.create_token(db.current_user_id.get(), label)
    return {"id": token_id, "label": label, "token": token}


@app.delete("/api/auth/tokens/{token_id}")
async def revoke_token(token_id: str):
    if not db.revoke_token(db.current_user_id.get(), token_id):
        raise HTTPException(status_code=404, detail="token not found")
    return {"status": "revoked"}


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
    if file_type not in VALID_FILES:
        raise HTTPException(status_code=400, detail=f"Unknown file type: {file_type}")
    write_json_file(file_type, update.data)
    return {"status": "saved", "file_type": file_type}


class SettingsUpdate(BaseModel):
    disabled_sections: list[str]


@app.get("/api/settings")
async def get_settings():
    return {
        "disabled_sections": sorted(settings_store.get_disabled_sections()),
        "toggleable": sorted(sections.toggleable_sections()),
        "always_on": sorted(sections.ALWAYS_ON_SECTIONS),
    }


@app.put("/api/settings")
async def update_settings(update: SettingsUpdate):
    requested = set(update.disabled_sections)
    invalid = requested - sections.toggleable_sections()
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot disable: {sorted(invalid)}. "
                   f"Toggleable: {sorted(sections.toggleable_sections())}",
        )
    settings_store.set_disabled_sections(sorted(requested))
    return {"status": "saved", "disabled_sections": sorted(requested)}


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
    if file_type not in sections.SECTION_REGISTRY:
        raise HTTPException(status_code=400, detail=f"No default for: {file_type}")
    write_json_file(file_type, copy.deepcopy(sections.SECTION_REGISTRY[file_type].default))
    return {"status": "reset", "file_type": file_type}


# ============================================================================
# Backup & Restore
# ============================================================================

@app.get("/api/export")
async def export_data():
    """Export the current user's MyGist data as a downloadable zip file."""
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        file_names = []
        for file_type in VALID_FILES:
            data = persona_store.load(file_type)
            name = f"{file_type}.json"
            zf.writestr(name, json.dumps(data, indent=2))
            file_names.append(name)
        metadata = {
            "exported_at": datetime.now().isoformat(),
            "version": "2.0.0",
            "files": file_names,
        }
        zf.writestr("_metadata.json", json.dumps(metadata, indent=2))

    zip_buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"mygist_backup_{timestamp}.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
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
    Import the current user's MyGist data from an uploaded zip file.

    mode: "replace" (default) - overwrites each file type
          "merge" - merges with existing data (arrays concatenated, objects merged)
    """
    if mode not in ("replace", "merge"):
        raise HTTPException(status_code=400, detail="Mode must be 'replace' or 'merge'")
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")

    zip_data = await file.read()
    try:
        zip_buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            # Security check: reject path-traversal names
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                if ".." in name or name.startswith("/"):
                    raise HTTPException(status_code=400, detail=f"Invalid filename: {name}")

            imported_files = []
            for name in zf.namelist():
                if not (name.endswith(".json") and not name.startswith("_")):
                    continue
                file_type = name[:-5]
                if file_type not in VALID_FILES:
                    continue
                incoming_data = json.loads(zf.read(name))
                if mode == "merge":
                    existing_data = persona_store.load(file_type)
                    incoming_data = deep_merge(existing_data, incoming_data)
                persona_store.save(file_type, incoming_data)
                imported_files.append(name)

            return {"status": "success", "mode": mode, "imported_files": imported_files}
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
