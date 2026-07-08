"""Declarative registry of persona sections — the single source of truth for
section-level structure (defaults, id-carrying lists, per-scope context fields).
Dependency-free: imports only stdlib so persona_store/server can import it
without a cycle. Per-entity write schema is intentionally NOT here (it stays in
server.ENTITY_SCHEMA); this registry owns section-level data only.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SectionSpec:
    key: str                       # file_type, e.g. "lifestyle"
    default: dict                  # skeleton (mirrors persona_store.DEFAULTS[key])
    id_lists: tuple = ()           # ((list_key, id_prefix), ...)
    context_fields: dict = field(default_factory=dict)  # {scope_name: [field, ...]}


# Global scope name -> human description (mirrors CONTEXT_SCOPES[...]["description"]).
SCOPES = {
    "minimal": "Quick identity snapshot",
    "professional": "Work-relevant context",
    "personal": "Hobbies, interests, personality, and tracked topics",
    "learning": "Current learning focus",
    "full": "Complete persona",
}


# Fields included in EVERY resolved scope (global and section). This is exactly
# the preferences slice every global scope carried before it was factored out.
ALWAYS_ON = {"preferences": ["code_style", "learning_style", "communication", "dislikes"]}


def all_scope_names() -> list[str]:
    """Every valid scope token: the global scope names plus one per section."""
    return list(SCOPES.keys()) + list(SECTION_REGISTRY.keys())


# Sections that can never be disabled by a user (always loaded / always visible).
# Distinct from ALWAYS_ON (the always-included preferences *field* bundle above).
ALWAYS_ON_SECTIONS = frozenset({"profile", "preferences", "learning_log"})


def toggleable_sections() -> set:
    """Registry sections a user may enable/disable (everything not always-on)."""
    return set(SECTION_REGISTRY) - ALWAYS_ON_SECTIONS


SECTION_REGISTRY = {
    "profile": SectionSpec(
        key="profile",
        default={  # VERBATIM from persona_store.DEFAULTS["profile"] (persona_store.py:67-84)
            "name": "", "preferred_name": "", "current_role": "", "organisation": "",
            "location": "", "nationality": "", "languages_spoken": [], "bio": "",
            "work_experience": [], "career_aspirations": [], "education": [],
            "goals_and_careers": [], "contact": {"emails": [], "links": []},
        },
        id_lists=(
            ("work_experience", "work"),
            ("education", "education"),
            ("languages_spoken", "language"),
            ("goals_and_careers", "goal"),
        ),
        context_fields={
            "minimal": ["name", "preferred_name", "bio", "location", "current_role"],
            "professional": ["name", "preferred_name", "bio", "location", "current_role",
                             "organisation", "nationality", "languages_spoken",
                             "work_experience", "education", "career_aspirations"],
            "personal": ["name", "preferred_name", "bio", "location",
                         "nationality", "languages_spoken", "goals_and_careers"],
            "learning": ["name", "preferred_name", "current_role", "career_aspirations"],
        },
    ),
    "knowledge": SectionSpec(
        key="knowledge",
        default={"domains": [], "mental_tabs": []},  # persona_store.py:85-88
        id_lists=(("domains", "domain"), ("mental_tabs", "tab")),
        context_fields={
            "professional": ["domains"],
            "personal": ["mental_tabs"],
            "learning": ["domains", "mental_tabs"],
        },
    ),
    "preferences": SectionSpec(
        key="preferences",
        default={  # VERBATIM from persona_store.DEFAULTS["preferences"] (persona_store.py:89-108)
            "code_style": {"preferred_languages": [], "frameworks": [], "tools": []},
            "communication": {
                "default": {"tone": "", "detail_level": "", "locale": "British English"},
                "mood_overrides": [],
            },
            "learning_style": {"preferred": [], "avoid": []},
            "dislikes": [],
        },
        id_lists=(),
        context_fields={},
    ),
    "projects": SectionSpec(
        key="projects",
        default={"projects": [], "current_learning": [], "top_of_mind": []},  # persona_store.py:109-113
        id_lists=(("projects", "project"), ("current_learning", "learning"), ("top_of_mind", "top")),
        context_fields={
            "minimal": ["top_of_mind"],
            "professional": ["projects", "current_learning", "top_of_mind"],
            "learning": ["current_learning", "top_of_mind"],
        },
    ),
    "lifestyle": SectionSpec(
        key="lifestyle",
        default={  # VERBATIM from persona_store.DEFAULTS["lifestyle"] (persona_store.py:114-128)
            "hobbies": [], "passions": [], "curiosities": [], "personality_traits": [],
            "values": [],
            "wellness": {
                "sleep": {"weekday": {"bedtime": "", "wakeup": ""},
                          "weekend": {"bedtime": "", "wakeup": ""}},
                "energy_peaks": [], "stress_triggers": [],
            },
        },
        id_lists=(("hobbies", "hobby"),),
        context_fields={
            "personal": ["hobbies", "passions", "curiosities", "personality_traits", "values", "wellness"],
        },
    ),
    "circle": SectionSpec(
        key="circle",
        default={"connections": []},  # persona_store.py:129-131
        id_lists=(("connections", "connection"),),
        context_fields={"personal": ["connections"]},
    ),
    "learning_log": SectionSpec(
        key="learning_log",
        default={"entries": []},  # persona_store.py:132-134
        id_lists=(),
        context_fields={"learning": ["entries"]},
    ),
}
