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


def get_enabled_optins() -> set[str]:
    """Default-off packs the user has explicitly enabled."""
    return set(get_settings().get("enabled_sections", []))


def set_enabled_optins(keys: list[str]) -> None:
    blob = get_settings()
    blob["enabled_sections"] = list(keys)
    set_settings(blob)


# The steps that COLLECT something, and are therefore the only ones whose
# status is a fact about the persona. `welcome` and `complete` are pages, and a
# status on either would record a page view.
ONBOARDING_STEP_KEYS = frozenset({"about-you", "how-you-like"})

# `skipped` is stored rather than derived, because it is the one thing a
# progress count over field values cannot recover: a reader who deliberately
# passed a step has not failed it, and both look identical from the data.
ONBOARDING_STATUSES = frozenset({"done", "skipped"})


def get_onboarding() -> dict:
    """Onboarding progress, always in the documented shape.

    Repaired rather than trusted on read: the blob is free-form, so a bad value
    must degrade to "nothing recorded yet" instead of breaking GET /api/settings
    for everything else that shares the response.
    """
    raw = get_settings().get("onboarding")
    if not isinstance(raw, dict):
        return {"dismissed": False, "steps": {}}
    steps = raw.get("steps")
    if not isinstance(steps, dict):
        steps = {}
    return {
        "dismissed": bool(raw.get("dismissed", False)),
        "steps": {
            k: v
            for k, v in steps.items()
            if k in ONBOARDING_STEP_KEYS and v in ONBOARDING_STATUSES
        },
    }


def set_onboarding(state: dict) -> None:
    blob = get_settings()
    blob["onboarding"] = {
        "dismissed": bool(state.get("dismissed", False)),
        "steps": dict(state.get("steps") or {}),
    }
    set_settings(blob)


def enabled_sections() -> set:
    """Registry sections visible to the current user. Core sections are always
    on; default-on packs are on unless disabled; default-off packs are on only
    if explicitly opted in."""
    disabled = get_disabled_sections() - sections.ALWAYS_ON_SECTIONS
    optins = get_enabled_optins()
    result = set()
    for key in sections.SECTION_REGISTRY:
        if key in sections.ALWAYS_ON_SECTIONS:
            result.add(key)
        elif not sections.DEFAULT_ENABLED.get(key, True):
            if key in optins:
                result.add(key)
        elif key not in disabled:
            result.add(key)
    return result
