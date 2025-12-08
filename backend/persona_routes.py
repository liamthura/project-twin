from fastapi import APIRouter, HTTPException
from pathlib import Path
import json

router = APIRouter(prefix="/mcp", tags=["mcp"])

DATA_DIR = Path(__file__).parent.parent / "persona_mcp" / "data"

# Helper to load JSON data
def load_json(filename):
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found")
    with open(path, "r") as f:
        return json.load(f)

@router.get("/persona")
def get_persona():
    """Get unified persona data with profile, interests, knowledge, preferences, and projects"""
    return {
        "profile": load_json("profile.json"),
        "interests": load_json("interests.json"),
        "knowledge": load_json("knowledge.json"),
        "preferences": load_json("preferences.json"),
        "projects": load_json("projects.json")
    }
