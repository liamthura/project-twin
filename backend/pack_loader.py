"""Loader for declarative section packs (backend/section_packs/*/manifest.json).

Each pack is one manifest validated against meta_schema.json. Invalid packs
are skipped with a warning (the server must always boot); cross-pack
collisions (duplicate entity names or id prefixes) raise PackError because
they are packaging bugs, not user data. sections.py and server.py build
their registry/entity-schema views from manifests() — this module must not
import either of them (they import us).
"""
import json
import logging
from pathlib import Path

import jsonschema

logger = logging.getLogger(__name__)

PACKS_DIR = Path(__file__).parent / "section_packs"
META_SCHEMA_PATH = PACKS_DIR / "meta_schema.json"

# Mirrors sections.SCOPES keys; asserted equal in tests to prevent drift.
GLOBAL_SCOPE_NAMES = frozenset({"minimal", "professional", "personal", "learning", "full"})


class PackError(Exception):
    """A manifest is invalid or two packs collide."""


_meta_validator = None


def _validator() -> jsonschema.Draft202012Validator:
    global _meta_validator
    if _meta_validator is None:
        schema = json.loads(META_SCHEMA_PATH.read_text())
        _meta_validator = jsonschema.Draft202012Validator(schema)
    return _meta_validator


def validate_manifest(manifest: dict) -> None:
    """Schema + intra-pack cross-reference checks. Raises PackError."""
    errors = sorted(_validator().iter_errors(manifest), key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        where = "/".join(str(p) for p in first.path) or "<root>"
        raise PackError(f"manifest schema violation at {where}: {first.message}")

    defaults = manifest["defaults"]
    for list_key, _prefix in manifest["id_lists"]:
        if not isinstance(defaults.get(list_key), list):
            raise PackError(
                f"id_lists references '{list_key}' which is not a list in defaults"
            )
    for scope in manifest.get("scope_contributions", {}):
        if scope not in GLOBAL_SCOPE_NAMES:
            raise PackError(f"unknown scope '{scope}' in scope_contributions")
