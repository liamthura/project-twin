"""Loader for declarative section packs (backend/section_packs/*/manifest.json).

Each pack is one manifest validated against meta_schema.json. Cross-pack
collisions (duplicate entity names or id prefixes) raise PackError because they
are packaging bugs, not user data — and so, since wave 11, does an invalid
manifest in the packs this repo ships, via load_packs(strict=True) from
manifests(). Warn-and-skip survives as the non-strict default, for a pack
directory the server does not own. sections.py and server.py build their
registry/entity-schema views from manifests() — this module must not import
either of them (they import us).
"""
import json
import logging
from pathlib import Path

import jsonschema
from jsonschema.exceptions import best_match

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
    error = best_match(_validator().iter_errors(manifest))
    # best_match descends into a `oneOf`/`anyOf` branch's own errors instead of
    # reporting the top-level "not valid under any of the given schemas" --
    # e.g. a `ui` list node missing `entity` fails both `$defs.ui` branches, so
    # the plain-first-by-path error used to name `ui` and dump the whole block
    # without ever saying `entity` is what's missing. This is purely about
    # which error is reported; it changes nothing about what validates.
    if error is not None:
        where = "/".join(str(p) for p in error.path) or "<root>"
        raise PackError(f"manifest schema violation at {where}: {error.message}")

    defaults = manifest["defaults"]
    for list_key, _prefix in manifest["id_lists"]:
        if not isinstance(defaults.get(list_key), list):
            raise PackError(
                f"id_lists references '{list_key}' which is not a list in defaults"
            )
    for scope in manifest.get("scope_contributions", {}):
        if scope not in GLOBAL_SCOPE_NAMES:
            raise PackError(f"unknown scope '{scope}' in scope_contributions")


def load_packs(packs_dir: Path = PACKS_DIR, strict: bool = False) -> dict[str, dict]:
    """Scan packs_dir for <key>/manifest.json. Cross-pack collisions → PackError.
    Returns manifests ordered by (position, key).

    `strict` decides what an invalid pack means, and the two answers are for two
    different situations:

      strict=False (default) -- warn and skip. Right for a pack directory the
        server does not own: one bad third-party pack must not stop it booting.

      strict=True -- raise. Right for the packs shipped IN THIS REPO, where an
        invalid manifest is a packaging bug, not a runtime condition. `manifests()`
        passes it, so the real load is fatal.

    The default used to apply everywhere, and it hid two bugs. Wave 6 put
    `exclusive_fields` in the `uiSection` block instead of the `entity` block; the
    aesthetics pack was skipped, and the first anyone knew was "❌ Unknown entity
    type: aesthetic" much later. Wave 8 put `$comment` on an entity the meta-schema
    did not allow it on; that one surfaced at import only because `profile` is
    core, so sections._check_core raises on its absence. A non-core pack had no
    such backstop -- it simply ceased to exist, and every symptom appeared
    somewhere far from the cause.
    """
    _validator()  # fail loudly on a broken meta-schema, not as per-pack invalidity
    loaded: list[dict] = []
    for entry in sorted(packs_dir.iterdir()) if packs_dir.exists() else []:
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        path = entry / "manifest.json"
        if not path.exists():
            if strict:
                raise PackError(f"section pack {entry.name}: no manifest.json")
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
            if strict:
                raise PackError(f"section pack {entry.name}: invalid manifest — {exc}") from exc
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
    """Cached load of the real packs directory (call _reset_cache() in tests).

    strict=True: these are the packs this repo ships, so an invalid one is a
    packaging bug that must stop the process rather than quietly remove a
    section. See load_packs for the two bugs the lenient default hid.
    """
    global _cache
    if _cache is None:
        _cache = load_packs(PACKS_DIR, strict=True)
    return _cache


def _reset_cache() -> None:
    global _cache
    _cache = None


def build_entity_schema(packs: dict[str, dict]) -> dict[str, dict]:
    """{section_key: entities} in pack order — server.ENTITY_SCHEMA shape.

    `$comment` is dropped here rather than left to each reader. ENTITY_SCHEMA is
    what `get_schema` hands to MCP clients, so an authoring note left in it would
    be shipped as part of the tool contract — and the meta-schema promises the
    opposite: `description` is the client-facing text, `$comment` is for the next
    author. Nothing else is filtered; unknown keys are the pack's business.
    """
    return {
        key: {
            entity: {k: v for k, v in spec.items() if k != "$comment"}
            for entity, spec in m["entities"].items()
        }
        for key, m in packs.items()
    }
