"""
Postgres-backed persona data store, scoped to the current request's user via
db.current_user_id. Replaces the old per-file-on-disk storage in main.py and
server.py; keeps the same "load whole blob / save whole blob" shape those
callers already expect.
"""

import json

import db

VALID_FILES = ["profile", "knowledge", "preferences", "projects", "lifestyle", "circle", "learning_log"]

FILE_MAP = {name: f"{name}.json" for name in VALID_FILES}

# Default data structures (ported verbatim from main.py's DEFAULTS)
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


def _normalize(file_type: str, data: dict) -> dict:
    """Legacy-format migration, ported verbatim from main.py's read_json_file.

    Operates on `data` (a blob already loaded from Postgres) instead of a
    locally-scoped dict read from disk. Current data is already migrated, but
    this stays a safety net for older backups/imports.
    """
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


def load(file_type: str) -> dict:
    """Load one persona file for the current user, or its default."""
    if file_type not in VALID_FILES:
        return {"error": f"{file_type} not found"}
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, file_type),
        ).fetchone()
    if row is None:
        return DEFAULTS.get(file_type, {})
    return _normalize(file_type, row["data"])


def save(file_type: str, data: dict) -> bool:
    """Save (upsert) one persona file for the current user."""
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        conn.execute(
            """
            insert into persona_data (user_id, file_type, data, updated_at)
            values (%s, %s, %s, now())
            on conflict (user_id, file_type)
            do update set data = excluded.data, updated_at = now()
            """,
            (user_id, file_type, json.dumps(data)),
        )
    return True


def get_all() -> dict:
    """Load every persona file for the current user."""
    return {file_type: load(file_type) for file_type in VALID_FILES}


def reset(file_type: str) -> bool:
    """Reset one file to its default."""
    return save(file_type, DEFAULTS[file_type])
