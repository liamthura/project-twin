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


def load_packs(packs_dir: Path = PACKS_DIR) -> dict[str, dict]:
    """Scan packs_dir for <key>/manifest.json. Invalid → warn + skip.
    Cross-pack collisions → PackError. Returns manifests ordered by
    (position, key)."""
    _validator()  # fail loudly on a broken meta-schema, not as per-pack invalidity
    loaded: list[dict] = []
    for entry in sorted(packs_dir.iterdir()) if packs_dir.exists() else []:
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        path = entry / "manifest.json"
        if not path.exists():
            logger.warning("section pack %s: no manifest.json — skipped", entry.name)
            continue
        try:
            manifest = json.loads(path.read_text())
            validate_manifest(manifest)
            if manifest["key"] != entry.name:
                raise PackError(
                    f"key '{manifest['key']}' does not match directory '{entry.name}'"
                )
        except (PackError, json.JSONDecodeError, OSError) as exc:
            logger.warning("section pack %s: invalid manifest — skipped (%s)", entry.name, exc)
            continue
        loaded.append(manifest)

    seen_entities: dict[str, str] = {}
    seen_prefixes: dict[str, str] = {}
    for m in loaded:
        for entity in m["entities"]:
            if entity in seen_entities:
                raise PackError(
                    f"entity '{entity}' defined by both '{seen_entities[entity]}' and '{m['key']}'"
                )
            seen_entities[entity] = m["key"]
        for _list_key, prefix in m["id_lists"]:
            if prefix in seen_prefixes and seen_prefixes[prefix] != m["key"]:
                raise PackError(
                    f"id prefix '{prefix}' used by both '{seen_prefixes[prefix]}' and '{m['key']}'"
                )
            seen_prefixes[prefix] = m["key"]

    loaded.sort(key=lambda m: (m["position"], m["key"]))
    return {m["key"]: m for m in loaded}


_cache: dict | None = None


def manifests() -> dict[str, dict]:
    """Cached load of the real packs directory (call _reset_cache() in tests)."""
    global _cache
    if _cache is None:
        _cache = load_packs(PACKS_DIR)
    return _cache


def _reset_cache() -> None:
    global _cache
    _cache = None


def build_entity_schema(packs: dict[str, dict]) -> dict[str, dict]:
    """{section_key: entities} in pack order — server.ENTITY_SCHEMA shape."""
    return {key: m["entities"] for key, m in packs.items()}
