"""Per-user settings blob, stored as a reserved `_settings` row in persona_data.

Kept separate from persona_store (which is registry-validated and id-assigns):
settings are user config, not persona content, and must never appear in
VALID_FILES / get_all / exports. Scoped to the current request's user via
db.current_user_id.
"""
import json

import db
import sections

SETTINGS_KEY = "_settings"


def get_settings() -> dict:
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, SETTINGS_KEY),
        ).fetchone()
    return row["data"] if row else {}


def set_settings(blob: dict) -> None:
    user_id = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        conn.execute(
            """
            insert into persona_data (user_id, file_type, data, updated_at)
            values (%s, %s, %s, now())
            on conflict (user_id, file_type)
            do update set data = excluded.data, updated_at = now()
            """,
            (user_id, SETTINGS_KEY, json.dumps(blob)),
        )


def get_disabled_sections() -> set[str]:
    return set(get_settings().get("disabled_sections", []))


def set_disabled_sections(keys: list[str]) -> None:
    blob = get_settings()
    blob["disabled_sections"] = list(keys)
    set_settings(blob)


def enabled_sections() -> set:
    """Registry sections visible to the current user: all minus their disabled
    set, with always-on sections force-included (a stale/hand-edited blob can
    never hide a core section)."""
    disabled = get_disabled_sections() - sections.ALWAYS_ON_SECTIONS
    return set(sections.SECTION_REGISTRY) - disabled
