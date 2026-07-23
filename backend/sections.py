"""Declarative registry of persona sections, built from section packs.

The single source of truth for section-level structure now lives in
backend/section_packs/<key>/manifest.json; this module loads those packs
once (via pack_loader) and exposes the same API downstream code has always
used. Per-entity write schema is also manifest-owned and surfaced as
server.ENTITY_SCHEMA — this registry owns section-level data only.
"""
import copy
from dataclasses import dataclass, field

import pack_loader


@dataclass(frozen=True)
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # skeleton persona blob for the section
    id_lists: tuple = ()           # ((list_key, id_prefix), ...)
    context_fields: dict = field(default_factory=dict)  # {scope_name: [field, ...]}


# Global scope name -> human description.
SCOPES = {
    "minimal": "Quick identity snapshot",
    "professional": "Work-relevant context",
    "personal": "Hobbies, interests, personality, and tracked topics",
    "learning": "Current learning focus",
    "full": "Complete persona",
}

assert set(SCOPES) == pack_loader.GLOBAL_SCOPE_NAMES  # keep the two lists in lockstep

# Fields included in EVERY resolved scope (global and section). This is exactly
# the preferences slice every global scope carried before it was factored out.
ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "dislikes"]}

# Core sections a corrupted/missing manifest must never silently drop.
_REQUIRED_CORE = frozenset({"profile", "preferences", "learning_log"})


def _check_core(manifests: dict) -> None:
    """Fail fast if a required core section failed to load — a silently
    missing core section is worse than refusing to boot."""
    missing = _REQUIRED_CORE - set(manifests)
    if missing:
        raise RuntimeError(
            f"core section pack(s) failed to load: {sorted(missing)} — "
            "check the section_packs warnings above"
        )


_MANIFESTS = pack_loader.manifests()
_check_core(_MANIFESTS)

SECTION_REGISTRY = {
    key: SectionSpec(
        key=key,
        default=copy.deepcopy(m["defaults"]),
        id_lists=tuple(tuple(pair) for pair in m["id_lists"]),
        context_fields=m.get("scope_contributions", {}),
    )
    for key, m in _MANIFESTS.items()
}

# Sections that can never be disabled by a user (always loaded / always visible).
# Distinct from ALWAYS_ON (the always-included preferences *field* bundle above).
ALWAYS_ON_SECTIONS = frozenset(k for k, m in _MANIFESTS.items() if m["core"])

# Display metadata for the Sections manager UI (pack order preserved).
PACK_META = {
    key: {"title": m["title"], "description": m["description"], "core": m["core"]}
    for key, m in _MANIFESTS.items()
}


def all_scope_names() -> list[str]:
    """Every valid scope token: the global scope names plus one per section."""
    return list(SCOPES.keys()) + list(SECTION_REGISTRY.keys())


def toggleable_sections() -> set:
    """Registry sections a user may enable/disable (everything not always-on)."""
    return set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS
