#!/usr/bin/env python3
"""
MyGist MCP Server - FastMCP Edition

Your portable personal context for AI.
Migrated to FastMCP for HTTP transport with Bearer token authentication.

Usage:
    # Development (stdio)
    python server.py
    
    # Production (HTTP with SSE)
    uvicorn server:app --host 0.0.0.0 --port 8000

Environment Variables:
    MYGIST_API_TOKEN: Bearer token for authentication (required in production)
    PERSONA_DATA_DIR: Path to persona data directory (default: ../mygist_data)
"""

import json
import os
import sys
import re
import secrets
import logging
# import zipfile
# import io
# import shutil
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal, Union, List
import uuid

from fastmcp import FastMCP
# from starlette.middleware.base import BaseHTTPMiddleware
# from starlette.requests import Request
# from starlette.responses import JSONResponse, Response
# from starlette.routing import Route
from dotenv import load_dotenv

import db
import persona_store
import search_index
import sections
import settings_store
from persona_store import FILE_MAP, generate_entity_id, get_all as get_all_persona_data
from sections import SECTION_REGISTRY

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(
    stream=sys.stderr,
    level=logging.DEBUG if os.getenv("DEBUG", "false").lower() == "true" else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Persona data is now stored in Postgres, scoped to the current request's user.
# FILE_MAP / get_all_persona_data come from persona_store (imported above);
# load_json / save_json below are thin delegators onto it.


# =============================================================================
# CONVERSATION CONTEXT - Pronoun resolution and state tracking
# =============================================================================

class ConversationContext:
    """
    Track conversation state to improve entity resolution.
    Helps resolve pronouns like 'it', 'that', 'this' to actual entities.
    """
    
    def __init__(self):
        self.last_mentioned = {
            "project": None,
            "skill": None,
            "hobby": None,
            "person": None,
            "place": None
        }
        self.conversation_topic = None
        self.recent_entities = []  # Last N entities mentioned
    
    def update_from_entities(self, entities: list):
        """Update context based on detected entities"""
        for entity in entities:
            entity_type = entity.get('type', '')
            entity_value = entity.get('value', '')
            
            if entity_type in self.last_mentioned:
                self.last_mentioned[entity_type] = entity_value
            
            # Keep last 10 entities for reference
            self.recent_entities.append({
                "type": entity_type,
                "value": entity_value
            })
            if len(self.recent_entities) > 10:
                self.recent_entities.pop(0)
    
    def get_likely_referent(self, pronoun: str) -> str:
        """When user says 'it', what are they referring to?"""
        if self.last_mentioned['project']:
            return self.last_mentioned['project']
        elif self.last_mentioned['skill']:
            return self.last_mentioned['skill']
        elif self.last_mentioned['hobby']:
            return self.last_mentioned['hobby']
        return None
    
    def clear(self):
        """Clear context for new conversation"""
        self.last_mentioned = {k: None for k in self.last_mentioned}
        self.recent_entities = []


# Global conversation context (per-server instance)
conversation_context = ConversationContext()


# =============================================================================
# SKILL LEVEL HIERARCHY AND DETECTION
# =============================================================================

SKILL_HIERARCHY = {
    "beginner": 1,
    "learning": 2, 
    "intermediate": 3,
    "advanced": 4,
    "expert": 5
}

def determine_skill_level(entity: str, message: str, triggers: list) -> str:
    """
    Infer skill level based on evidence in message.
    More conservative - one project doesn't make you advanced.
    """
    message_lower = message.lower()
    
    # Check for concrete outputs (strong signal)
    output_verbs = ['built', 'created', 'deployed', 'shipped', 'developed', 'made', 'launched', 'published']
    has_output = any(verb in message_lower for verb in output_verbs)
    
    # Check for duration/sustainability
    duration_words = ['months', 'weeks', 'regularly', 'for years', 'for a while']
    has_duration = any(word in message_lower for word in duration_words)
    
    # Check for proficiency claims
    proficiency_words = ['comfortable', 'proficient', 'good at', 'expert', 'master', 'fluent', 'solid', 'advanced']
    claims_proficiency = any(word in message_lower for word in proficiency_words)
    
    # Check for starting language
    starting_words = ['trying', 'exploring', 'just started', 'new to', 'picking up', 'getting into', 'diving into']
    is_starting = any(word in message_lower for word in starting_words)
    
    # Conservative level determination
    if claims_proficiency:
        return "advanced"
    elif has_output and has_duration and not is_starting:
        return "advanced"
    elif has_output and not is_starting:
        return "intermediate"
    elif has_output and is_starting:
        return "learning"
    elif has_duration or 'been learning' in message_lower:
        return "learning"
    elif is_starting:
        return "beginner"
    else:
        return "learning"


# =============================================================================
# VAGUE NAMES TO IGNORE
# =============================================================================

IGNORE_VAGUE_NAMES = {
    "it", "this", "that", "these", "those", "something", "stuff", "things",
    "small", "little", "quick", "simple", "basic", "cool", "nice", "new",
    "tool", "app", "script", "project", "thing", "code", "program",
    "side project", "small project", "little project", "quick project",
    "cli tool", "web app", "small app", "test app", "demo app",
    "a lot", "some stuff", "various things", "other things",
}


# =============================================================================
# EXPLICIT STATE CHANGE DETECTION
# =============================================================================

EXPLICIT_STATE_PATTERNS = {
    "completion": {
        "phrases": ["finished", "completed", "done with", "wrapped up", "submitted", "handed in"],
        "confidence_boost": 0.25,
        "action": "mark_complete"
    },
    "start": {
        "phrases": ["started", "began", "kicked off", "launched", "just began"],
        "confidence_boost": 0.20,
        "action": "mark_active"
    },
    "stop": {
        "phrases": ["stopped", "quit", "gave up", "not doing anymore", "lost interest", "dropped"],
        "confidence_boost": 0.20,
        "action": "mark_inactive_or_remove"
    },
    "achievement": {
        "phrases": ["accepted", "got accepted", "won", "awarded", "promoted", "hired", "got the job", "landed"],
        "confidence_boost": 0.30,
        "action": "add_achievement"
    },
    "location_change": {
        "phrases": ["moved to", "relocated to", "living in", "based in now", "moving to"],
        "confidence_boost": 0.25,
        "action": "update_location"
    }
}

def detect_explicit_state_changes(message: str) -> list:
    """Detect high-confidence state changes that warrant immediate action."""
    detected = []
    message_lower = message.lower()
    
    for change_type, config in EXPLICIT_STATE_PATTERNS.items():
        for phrase in config['phrases']:
            if phrase in message_lower:
                detected.append({
                    "type": change_type,
                    "phrase": phrase,
                    "confidence_boost": config['confidence_boost'],
                    "recommended_action": config['action']
                })
                break
    
    return detected


# =============================================================================
# CONFIDENCE CALCULATION SYSTEM
# =============================================================================

def calculate_evidence_boost(triggers: list, state_changes: list, has_duration: bool, sentiment_positive: bool) -> float:
    """Boost confidence when multiple signals support the same conclusion."""
    evidence_count = 0
    
    if len(triggers) > 0:
        evidence_count += 1
    if state_changes:
        evidence_count += 1
    if has_duration:
        evidence_count += 1
    if sentiment_positive:
        evidence_count += 1
    
    if evidence_count <= 1:
        return 0.0
    else:
        return min(0.05 * (evidence_count - 1), 0.15)


SENTIMENT_MULTIPLIERS = {
    "sarcastic": 0.25, "very_negative": 0.50, "venting": 0.60,
    "negative": 0.70, "hypothetical": 0.35, "uncertain": 0.80,
    "questioning": 0.70, "neutral": 0.90, "declarative": 1.00,
    "positive": 1.00, "very_positive": 1.10
}

TRIGGER_STRENGTH_BOOSTS = {
    "explicit": 0.10, "strong": 0.06, "moderate": 0.03, "weak": 0.00
}

def calculate_final_confidence_v2(
    base_confidence: float,
    sentiment_type: str,
    trigger_strength: str,
    evidence_boost: float,
    entity_exists: bool,
    recurrence: int = 0
) -> float:
    """Confidence calculation with balanced sentiment impact."""
    score = base_confidence
    
    # Sentiment multiplier
    multiplier = SENTIMENT_MULTIPLIERS.get(sentiment_type, 0.85)
    score *= multiplier
    
    # Additive boosts (capped)
    trigger_boost = TRIGGER_STRENGTH_BOOSTS.get(trigger_strength, 0.0)
    existence_boost = 0.05 if entity_exists else 0.0
    recurrence_boost = 0.08 * min(recurrence - 1, 3) if recurrence >= 2 else 0.0
    
    total_boost = trigger_boost + evidence_boost + existence_boost + recurrence_boost
    capped_boost = min(total_boost, 0.20)
    
    score += capped_boost
    
    return min(max(score, 0.0), 0.98)


# Entity-specific confidence thresholds
ENTITY_THRESHOLDS = {
    "profile": {"auto": 0.88, "ask": 0.65},
    "work_experience": {"auto": 0.85, "ask": 0.60},
    "education": {"auto": 0.85, "ask": 0.60},
    "project": {"auto": 0.82, "ask": 0.55},
    "domain": {"auto": 0.80, "ask": 0.55},
    "hobby": {"auto": 0.78, "ask": 0.50},
    "hobby_reference": {"auto": 0.70, "ask": 0.45},
    "preference": {"auto": 0.75, "ask": 0.55},
    "dislike": {"auto": 0.75, "ask": 0.50},
    "communication_default": {"auto": 0.80, "ask": 0.55},
    "basic_info": {"auto": 0.90, "ask": 0.70},
    "mood_override": {"auto": 0.75, "ask": 0.50},
    "passion": {"auto": 0.72, "ask": 0.50},
    "curiosity": {"auto": 0.70, "ask": 0.45},
    "personality_trait": {"auto": 0.80, "ask": 0.55},
}

def get_action_from_confidence(confidence: float, entity_type: str, is_removal: bool = False) -> str:
    """Determine action based on confidence + entity type + operation type."""
    if is_removal:
        return "ask_user" if confidence >= 0.50 else "ignore"
    
    thresholds = ENTITY_THRESHOLDS.get(entity_type, {"auto": 0.80, "ask": 0.50})
    
    if confidence >= thresholds["auto"]:
        return "auto_apply"
    elif confidence >= thresholds["ask"]:
        return "ask_user"
    else:
        return "ignore"


# =============================================================================
# SUGGESTION PROCESSING HELPERS
# =============================================================================

def deduplicate_suggestions(suggestions: list) -> list:
    """Merge multiple suggestions targeting the same entity."""
    if not suggestions:
        return suggestions
    
    entity_map = {}
    
    for suggestion in suggestions:
        entity_name = suggestion.get('data', {}).get('name', '')
        entity_key = (suggestion['entity'], entity_name.lower())
        
        if entity_key not in entity_map:
            entity_map[entity_key] = suggestion.copy()
            entity_map[entity_key]['evidence'] = [suggestion.get('reason', '')]
        else:
            existing = entity_map[entity_key]
            existing['evidence'].append(suggestion.get('reason', ''))
            
            # Keep higher skill level if applicable
            if 'level' in suggestion.get('data', {}):
                current_level = existing['data'].get('level', 'learning')
                new_level = suggestion['data']['level']
                if SKILL_HIERARCHY.get(new_level, 0) > SKILL_HIERARCHY.get(current_level, 0):
                    existing['data']['level'] = new_level
            
            # Boost confidence for multiple signals
            existing['confidence'] = min(existing['confidence'] + 0.15, 1.0)
    
    return list(entity_map.values())


PRONOUNS = ['it', 'that', 'this', 'them', 'they', 'one']

def is_pronoun(text: str) -> bool:
    """Check if text is a pronoun"""
    return text.lower().strip() in PRONOUNS

def resolve_pronoun_references(entities: list, message: str, context: ConversationContext) -> list:
    """Resolve pronouns (it, that, this) to actual entities from context."""
    resolved = []
    
    for entity in entities:
        entity_value = entity.get('value', '').lower().strip()
        
        if is_pronoun(entity_value):
            referent = context.get_likely_referent(entity_value)
            if referent:
                entity = entity.copy()
                entity['value'] = referent
                entity['resolved_from_pronoun'] = True
                entity['confidence'] = entity.get('confidence', 0.7) * 0.8
            else:
                continue
        elif any(pronoun in entity_value.split() for pronoun in PRONOUNS):
            words = [w for w in entity_value.split() if w.lower() not in PRONOUNS]
            if len(words) >= 2:
                entity = entity.copy()
                entity['value'] = ' '.join(words)
                entity['filtered_pronoun'] = True
            else:
                continue
        
        resolved.append(entity)
    
    return resolved

# -----------------------------------------------------------------------------
# PERSONA CROSS-REFERENCE HELPERS - ADD VS UPDATE VS SKIP LOGIC
# -----------------------------------------------------------------------------


def find_in_persona(persona: dict, entity_type: str, name: str) -> dict:
    """Search persona for existing entity by type and name"""
    if not name:
        return None
    
    name_lower = name.lower()
    
    search_paths = {
        "domain": ("knowledge", "domains"),
        "hobby": ("lifestyle", "hobbies"),
        "project": ("projects", "projects"),
        "passion": ("lifestyle", "passions"),
        "curiosity": ("lifestyle", "curiosities"),
        "personality_trait": ("lifestyle", "personality_traits"),
        "dislike": ("preferences", "dislikes"),
        "connection": ("circle", "connections"),
    }
    
    if entity_type in search_paths:
        section, key = search_paths[entity_type]
        items = persona.get(section, {}).get(key, [])
        
        for item in items:
            if isinstance(item, dict):
                if item.get('name', '').lower() == name_lower:
                    return item
            elif isinstance(item, str):
                if item.lower() == name_lower:
                    return {"name": item}
    
    return None


def cross_reference_persona(suggestion: dict, persona: dict) -> dict:
    """
    Check suggestion against existing persona to:
    1. Convert ADD → UPDATE if entity exists
    2. Boost confidence for updating existing data
    3. Detect conflicts (downgrade from intermediate to beginner)
    4. Skip if data unchanged
    """
    suggestion = suggestion.copy()
    entity_type = suggestion['entity']
    data = suggestion.get('data', {})
    name = data.get('name', '')
    
    existing = find_in_persona(persona, entity_type, name)
    
    if existing:
        if suggestion['action'] == 'add':
            suggestion['action'] = 'update'
            suggestion['confidence'] += 0.10
            suggestion['reason'] = suggestion.get('reason', '') + " (updating existing entry)"
        
        if 'level' in data and 'level' in existing:
            current = SKILL_HIERARCHY.get(existing['level'], 0)
            proposed = SKILL_HIERARCHY.get(data['level'], 0)
            
            if proposed < current:
                suggestion['confidence'] = min(suggestion['confidence'], 0.65)
                suggestion['conflict'] = {
                    "field": "level",
                    "current": existing['level'],
                    "proposed": data['level'],
                    "requires_confirmation": True
                }
        
        if is_same_data(existing, data):
            suggestion['action'] = 'skip'
            suggestion['confidence'] = 0.0
            suggestion['reason'] = "Data unchanged from existing"
    else:
        if suggestion['action'] == 'update':
            suggestion['action'] = 'add'
    
    return suggestion


def is_same_data(existing: dict, proposed: dict) -> bool:
    """Check if proposed data is same as existing"""
    for key, value in proposed.items():
        if existing.get(key) != value:
            return False
    return True

# -----------------------------------------------------------------------------
# UX CONSOLIDATION - GROUP SUGGESTIONS FOR BETTER PROMPTS
# -----------------------------------------------------------------------------

def consolidate_suggestions_for_ux(suggestions: list) -> dict:
    """
    Group suggestions for better UX.
    Returns:
    {
        "auto_apply": [...],      # High confidence - just notify
        "batch_confirm": [...],    # Medium confidence - ask once for all
        "individual_confirm": [...] # Mixed confidence - ask individually
    }
    """
    auto_apply = []
    ask_user = []
    
    for s in suggestions:
        action = get_action_from_confidence(
            s['confidence'], 
            s['entity'], 
            s.get('action') == 'remove'
        )
        
        if action == "auto_apply":
            auto_apply.append(s)
        elif action == "ask_user":
            ask_user.append(s)
    
    if len(ask_user) >= 3:
        return {
            "auto_apply": auto_apply,
            "batch_confirm": ask_user,
            "individual_confirm": [],
            "ui_hint": "batch_prompt"
        }
    else:
        return {
            "auto_apply": auto_apply,
            "batch_confirm": [],
            "individual_confirm": ask_user,
            "ui_hint": "inline_prompts"
        }


# =============================================================================
# BEARER TOKEN AUTHENTICATION MIDDLEWARE
# =============================================================================
# TODO: commented out here
# class BearerAuthMiddleware(BaseHTTPMiddleware):
#     """
#     Middleware that validates Bearer token on all requests.
#     Skips authentication for health check endpoints.
#     """
    
#     SKIP_AUTH_PATHS = frozenset({"/", "/health", "/healthz"})
    
#     def __init__(self, app, token: str | None = None):
#         super().__init__(app)
#         self.token = token
#         self._auth_enabled = bool(token)
        
#         if not self._auth_enabled:
#             logger.warning(
#                 "⚠️  MYGIST_API_TOKEN not set - authentication disabled! "
#                 "Set this env var in production."
#             )
    
#     async def dispatch(self, request: Request, call_next) -> Response:
#         # Skip auth for health endpoints
#         if request.url.path in self.SKIP_AUTH_PATHS:
#             return await call_next(request)
        
#         # Skip auth if no token configured (dev mode)
#         if not self._auth_enabled:
#             return await call_next(request)
        
#         # Extract and validate Authorization header
#         auth_header = request.headers.get("Authorization", "")
        
#         if not auth_header:
#             logger.warning(f"Missing Authorization header from {request.client.host}")
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Missing Authorization header"}
#             )
        
#         parts = auth_header.split(" ", 1)
#         if len(parts) != 2 or parts[0].lower() != "bearer":
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Invalid Authorization header format. Use: Bearer <token>"}
#             )
        
#         # Timing-safe comparison
#         if not secrets.compare_digest(parts[1], self.token):
#             logger.warning(f"Invalid token from {request.client.host}")
#             return JSONResponse(
#                 status_code=401,
#                 content={"error": "Unauthorized", "message": "Invalid bearer token"}
#             )
        
#         return await call_next(request)


# =============================================================================
# CORE DATA FUNCTIONS
# =============================================================================

def load_json(filename: str) -> dict:
    """Load JSON data for the current user. `filename` is the historical
    "<type>.json" form used throughout this file; persona_store works in
    bare type names."""
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.load(file_type)

def save_json(filename: str, data: dict) -> bool:
    file_type = filename[:-5] if filename.endswith(".json") else filename
    return persona_store.save(file_type, data)

def get_nested_value(data: dict, path: str):
    """Get a value from nested dict using dot notation path"""
    keys = path.split(".")
    current = data
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(current, list):
            found = next((item for item in current if isinstance(item, dict) and item.get("name", "").lower() == key.lower()), None)
            if found:
                current = found
            else:
                try:
                    current = current[int(key)]
                except (ValueError, IndexError):
                    return None
        else:
            return None
        if current is None:
            return None
    return current

def set_nested_value(data: dict, path: str, value, create_missing: bool = True):
    """Set a value in nested dict using dot notation path"""
    keys = path.split(".")
    current = data
    
    for i, key in enumerate(keys[:-1]):
        if isinstance(current, dict):
            if key not in current and create_missing:
                current[key] = {}
            current = current.get(key)
        elif isinstance(current, list):
            found = next((item for item in current if isinstance(item, dict) and item.get("name", "").lower() == key.lower()), None)
            if found:
                current = found
            else:
                return False
        if current is None:
            return False
    
    final_key = keys[-1]
    if isinstance(current, dict):
        current[final_key] = value
        return True
    return False

def find_in_array(array: list, identifier: str, id_field: str = "name") -> tuple:
    """Find an item in array by identifier. Returns (index, item) or (-1, None)"""
    for i, item in enumerate(array):
        if isinstance(item, dict):
            if item.get(id_field, "").lower() == identifier.lower():
                return (i, item)
        elif isinstance(item, str) and item.lower() == identifier.lower():
            return (i, item)
    return (-1, None)

def get_field(data: dict, *field_names, default=None):
    """Get a field value trying multiple possible field names."""
    for name in field_names:
        if data.get(name) is not None:
            return data[name]
    return default


# =============================================================================
# SCOPED CONTEXT SYSTEM
# =============================================================================

# Canonical file order for context output — reproduces the historical
# CONTEXT_SCOPES key order exactly (preferences first, then the rest).
_CONTEXT_FILE_ORDER = ("preferences", "profile", "lifestyle", "knowledge", "circle", "projects", "learning_log")


def _merge_fields(target: dict, addition: dict) -> None:
    """Union a {file: [fields]} addition into target in place, preserving order
    and de-duplicating."""
    for file_key, field_list in addition.items():
        existing = target.setdefault(file_key, [])
        for f in field_list:
            if f not in existing:
                existing.append(f)


def _resolve_scope_fields(scope: str):
    """Resolve one scope token to its {file_key: [fields]} selection, or "all"
    for the full scope. Accepts a global scope name or a section key; the
    ALWAYS_ON bundle is folded into every non-full result. Keys are emitted in
    _CONTEXT_FILE_ORDER so context output byte-matches the legacy key order."""
    if scope == "full":
        return "all"
    matched: dict = {}
    _merge_fields(matched, sections.ALWAYS_ON)  # always-on first so its field order wins
    if scope in sections.SECTION_REGISTRY and scope not in sections.SCOPES:
        # Section scope: the whole section, all its default fields.
        _merge_fields(matched, {scope: list(sections.SECTION_REGISTRY[scope].default.keys())})
    else:
        # Global scope: each section's declared fields for this scope.
        for spec in sections.SECTION_REGISTRY.values():
            if scope in spec.context_fields:
                _merge_fields(matched, {spec.key: list(spec.context_fields[scope])})
    ordered_keys = [k for k in _CONTEXT_FILE_ORDER if k in matched]
    ordered_keys += [k for k in matched if k not in _CONTEXT_FILE_ORDER]
    return {k: matched[k] for k in ordered_keys}

def _resolve_scope_fields_multi(scopes):
    """Resolve one scope (str) or several (list) into a single {file: [fields]}
    selection, or "all" if any token is the full scope. Unknown tokens raise
    ValueError so the caller can surface a friendly error."""
    tokens = [scopes] if isinstance(scopes, str) else list(scopes)
    valid = set(sections.all_scope_names())
    merged: dict = {}
    for tok in tokens:
        if tok not in valid:
            raise ValueError(tok)
        resolved = _resolve_scope_fields(tok)
        if resolved == "all":
            return "all"
        _merge_fields(merged, resolved)
    return merged

def _files_for_scope(fields) -> list[str]:
    """Return the persona file keys a scope actually needs. ``fields`` is the
    resolved selection from _resolve_scope_fields: the string "all" needs every
    file; a {file: fields} dict needs only its keys."""
    if fields == "all":
        return list(persona_store.VALID_FILES)
    return list(fields.keys())

def get_scoped_context(
    scope: Union[str, List[str]] = "minimal",
    topic: str = None,
    include_inactive: bool = False,
    days: int = None,
    limit: int = None
) -> dict:
    """Get persona context filtered by scope(s) and optional topic. `scope` is a
    global scope name, a section key, or a list mixing them (unioned)."""
    try:
        fields = _resolve_scope_fields_multi(scope)
    except ValueError as e:
        return {"error": f"Unknown scope '{e.args[0]}'. Valid: {sections.all_scope_names()}"}

    enabled = settings_store.enabled_sections()
    # A section scope that names a disabled section is an explicit error.
    for tok in ([scope] if isinstance(scope, str) else scope):
        if tok in sections.SECTION_REGISTRY and tok not in enabled:
            return {"error": f"Section '{tok}' is disabled. Enable it in settings."}

    if fields == "all":
        needed = [ft for ft in persona_store.VALID_FILES if ft in enabled]
    else:
        # Global/list scopes silently omit disabled sections.
        fields = {fk: fl for fk, fl in fields.items() if fk in enabled}
        needed = _files_for_scope(fields)

    all_data = {ft: load_json(FILE_MAP[ft]) for ft in needed}
    result = {}

    if fields == "all":
        result = all_data
    else:
        for file_key, field_list in fields.items():
            data = all_data.get(file_key, {})
            if not data or "error" in data:
                continue
            result[file_key] = {}
            for field in field_list:
                if field == "communication_default":
                    comm = data.get("communication", {})
                    if isinstance(comm, dict) and "default" in comm:
                        result[file_key]["communication"] = {"default": comm["default"]}
                elif field in data:
                    result[file_key][field] = data[field]
    
    if topic:
        result = _filter_by_topic(result, topic.lower())
    
    if "learning_log" in result and not topic:
        is_learning = scope == "learning" or (not isinstance(scope, str) and "learning" in scope)
        effective_days = days if days is not None else (60 if is_learning else None)
        if effective_days and effective_days > 0:
            result = _filter_learning_log_by_time(result, effective_days, limit)
        elif limit and limit > 0:
            result = _filter_learning_log_by_time(result, None, limit)
    elif "learning_log" in result and topic and limit and limit > 0:
        result = _filter_learning_log_by_time(result, None, limit)
    
    if not include_inactive:
        result = _filter_inactive(result)
    
    scope_label = scope if isinstance(scope, str) else ",".join(scope)
    scope_desc = (
        sections.SCOPES.get(scope, f"{scope} section only")
        if isinstance(scope, str)
        else "Combined scopes"
    )
    payload = {
        "scope": scope_label,
        "scope_description": scope_desc,
        "topic_filter": topic,
        "token_estimate": 0,
        "context": result
    }
    # Estimate against the full wrapper (the actual payload the caller receives),
    # not just the inner context. The few chars the final estimate value itself
    # adds are absorbed by the //4 heuristic.
    payload["token_estimate"] = len(json.dumps(payload, ensure_ascii=False)) // 4
    return payload

def _parse_learning_ts(timestamp) -> datetime:
    """Parse a learning_log timestamp into a timezone-aware UTC datetime.

    Handles both ``Z``-suffixed UTC (``2025-12-09T19:56:00Z``) and naive
    microsecond ISO (``2026-03-21T03:32:26.410768``) formats. Naive values are
    assumed to be UTC. A missing or unparseable timestamp fails *closed*: it is
    treated as the minimum datetime so such entries sort LAST and never jump the
    recency window.
    """
    if not isinstance(timestamp, str) or not timestamp.strip():
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        s = timestamp.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _filter_learning_log_by_time(data: dict, days: Optional[int] = None, limit: Optional[int] = None) -> dict:
    """Filter learning_log entries by time and/or count, newest-first.

    Accepts either the wrapped shape ``{"learning_log": {"entries": [...]}}``
    (as passed by ``get_scoped_context``) or a bare blob ``{"entries": [...]}``.
    Entries are sorted newest-first by parsed timestamp; ``days`` applies a
    UTC recency window and ``limit`` keeps the NEWEST N. Entries with a
    missing/unparseable timestamp sort last and are dropped by any date window.
    """
    if (
        isinstance(data.get("learning_log"), dict)
        and "entries" in data["learning_log"]
    ):
        blob = data["learning_log"]
        wrapped = True
    elif "entries" in data:
        blob = data
        wrapped = False
    else:
        return data

    all_entries = blob["entries"]
    filter_parts = []

    # Pair each entry with its parsed timestamp and sort newest-first. Sorting
    # by the key alone (not the tuple) avoids comparing the entry dicts on ties.
    parsed = [(_parse_learning_ts(e.get("timestamp")), e) for e in all_entries]
    parsed.sort(key=lambda pair: pair[0], reverse=True)

    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        parsed = [pair for pair in parsed if pair[0] >= cutoff]
        filter_parts.append(f"last {days} days")

    if limit and limit > 0 and len(parsed) > limit:
        parsed = parsed[:limit]
        filter_parts.append(f"newest {limit}")

    filtered_entries = [entry for _, entry in parsed]

    if filter_parts:
        filter_desc = (
            " + ".join(filter_parts)
            + f" ({len(filtered_entries)}/{len(all_entries)} entries, newest first)"
        )
    else:
        filter_desc = "no filter applied (newest first)"

    new_blob = {**blob, "entries": filtered_entries, "_filter": filter_desc}
    if wrapped:
        result = dict(data)
        result["learning_log"] = new_blob
        return result
    return new_blob

# Cosine distance cutoff for the vector half of hybrid-mode topic filtering.
# pgvector's KNN has no built-in similarity threshold -- it always returns the
# nearest CANDIDATES rows regardless of how dissimilar they actually are, so
# without a cutoff every entity "matches" once a corpus has fewer than
# CANDIDATES items. Related concepts typically land under ~0.5 cosine distance
# for real embedding models; unrelated/orthogonal vectors (including this
# suite's one-hot fakes) sit at 1.0.
TOPIC_VECTOR_DISTANCE_CUTOFF = 0.5

def _filter_by_topic(data: dict, topic: str) -> dict:
    """Keep only id-list items relevant to `topic`, via the search index
    (hybrid when embeddings are configured, FTS otherwise). Non-id-list
    fields pass through untouched."""
    import search_index

    present_sections = [ft for ft in data if ft in sections.SECTION_REGISTRY]
    id_sections = [ft for ft in present_sections
                   if sections.SECTION_REGISTRY[ft].id_lists]
    if not id_sections:
        return data
    user_id = db.current_user_id.get()
    hits = search_index.search(user_id, topic, id_sections, 100)
    matched = {
        r["entity_id"] for r in hits["results"]
        if r["fts_hit"] or (r["distance"] is not None
                             and r["distance"] <= TOPIC_VECTOR_DISTANCE_CUTOFF)
    }
    for ft in id_sections:
        spec = sections.SECTION_REGISTRY[ft]
        section_data = data.get(ft)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            if list_key in section_data and isinstance(section_data[list_key], list):
                section_data[list_key] = [
                    item for item in section_data[list_key]
                    if isinstance(item, dict) and item.get("id") in matched
                ]
    return data

def _filter_inactive(data: dict) -> dict:
    """Remove inactive/paused items from context."""
    filtered = {}
    
    for key, section in data.items():
        if not isinstance(section, dict):
            filtered[key] = section
            continue
        filtered[key] = {}
        for field, value in section.items():
            if isinstance(value, list):
                active_items = []
                for item in value:
                    if isinstance(item, dict):
                        status = item.get("status", "active")
                        if status in ["active", "open", "exploring", "planning", None, "completed"]:
                            active_items.append(item)
                    else:
                        active_items.append(item)
                if active_items:
                    filtered[key][field] = active_items
            else:
                filtered[key][field] = value
        if not filtered[key]:
            del filtered[key]
    
    return filtered


# =============================================================================
# FIELD ALIASES & NORMALIZATION
# =============================================================================

FIELD_ALIASES = {
    "name": ["name", "title", "label", "value", "item"],
    "hobby": ["name", "hobby", "hobby_name", "title", "activity"],
    "project": ["name", "project", "project_name", "title"],
    "domain": ["name", "domain", "domain_name", "area", "topic"],
    "language": ["name", "language", "language_name", "lang"],
    "email": ["address", "email", "email_address", "mail"],
    "link": ["url", "link", "href", "website"],
    "aspiration": ["aspiration", "goal", "career_goal", "objective", "aim"],
    "curiosity": ["topic", "curiosity", "subject", "interest", "name"],
    "value": ["value", "core_value", "belief", "principle", "name"],
    "trait": ["trait", "personality_trait", "characteristic", "quality", "name"],
    "passion": ["name", "passion", "interest", "topic"],
    "mental_tab": ["name", "mental_tab", "topic", "title", "subject"],
    "learning_item": ["topic", "subject", "item", "name", "learning"],
    "top_of_mind": ["topic", "item", "subject", "thought", "name"],
    "connection": ["name", "person", "contact", "connection_name"],
}

def normalize_data(data: dict, entity: str) -> dict:
    """Normalize field names in data to canonical form based on entity type."""
    if not isinstance(data, dict):
        return data
    
    normalized = dict(data)
    
    if entity in ["hobby", "hobby_reference", "hobby_specific"]:
        name_aliases = FIELD_ALIASES.get("hobby", FIELD_ALIASES["name"])
    elif entity in ["project", "project_tag", "project_reference"]:
        name_aliases = FIELD_ALIASES.get("project", FIELD_ALIASES["name"])
    elif entity == "email":
        name_aliases = FIELD_ALIASES.get("email", ["address"])
    elif entity == "link":
        return normalized
    elif entity == "basic_info":
        return normalized
    elif entity == "language":
        name_aliases = FIELD_ALIASES.get("language", FIELD_ALIASES["name"])
    elif entity == "career_aspiration":
        name_aliases = FIELD_ALIASES.get("aspiration", ["aspiration"])
    elif entity == "curiosity":
        name_aliases = FIELD_ALIASES.get("curiosity", ["topic"])
    elif entity in ["value", "core_value"]:
        name_aliases = FIELD_ALIASES.get("value", ["value"])
    elif entity in ["trait", "personality_trait"]:
        name_aliases = FIELD_ALIASES.get("trait", ["trait"])
    elif entity == "passion":
        name_aliases = FIELD_ALIASES.get("passion", FIELD_ALIASES["name"])
    elif entity in ["mental_tab", "mental_tab_reference"]:
        name_aliases = FIELD_ALIASES.get("mental_tab", FIELD_ALIASES["name"])
    elif entity == "domain" or entity == "knowledge":
        name_aliases = FIELD_ALIASES.get("domain", FIELD_ALIASES["name"])
    elif entity == "domain_reference":
        name_aliases = FIELD_ALIASES.get("domain", FIELD_ALIASES["name"])
    elif entity == "current_learning":
        name_aliases = FIELD_ALIASES.get("learning_item", ["topic"])
    elif entity == "top_of_mind":
        name_aliases = FIELD_ALIASES.get("top_of_mind", ["topic"])
    elif entity == "connection":
        name_aliases = FIELD_ALIASES.get("connection", FIELD_ALIASES["name"])
    else:
        name_aliases = FIELD_ALIASES["name"]
    
    if "name" not in normalized:
        for alias in name_aliases:
            if alias in normalized and alias != "name":
                normalized["name"] = normalized[alias]
                break
    
    if entity == "email" and "address" not in normalized:
        for alias in FIELD_ALIASES["email"]:
            if alias in normalized and alias != "address":
                normalized["address"] = normalized[alias]
                break
    
    return normalized


# Allowed related_entries link types -> (file, list_key) they must resolve into.
_RELATED_ENTRY_TYPES = {
    "domain": ("knowledge.json", "domains"),
    "project": ("projects.json", "projects"),
    "hobby": ("lifestyle.json", "hobbies"),
}

def _validate_related_entries(links):
    """Return an error string if any link is malformed or dangling, else None."""
    if not isinstance(links, list):
        return "❌ related_entries must be a list of {type, id} objects"
    for link in links:
        if not isinstance(link, dict) or not link.get("type") or not link.get("id"):
            return f"❌ Malformed related entry (need type and id): {link}"
        spec = _RELATED_ENTRY_TYPES.get(link["type"])
        if spec is None:
            valid = ", ".join(sorted(_RELATED_ENTRY_TYPES))
            return f"❌ Unknown related entry type '{link['type']}' (valid: {valid})"
        file_name, list_key = spec
        items = load_json(file_name).get(list_key, [])
        if not any(isinstance(i, dict) and i.get("id") == link["id"] for i in items):
            return f"❌ Related {link['type']} not found: {link['id']}"
    return None


# =============================================================================
# EXECUTE MODIFY - Core entity modification logic
# =============================================================================

def execute_modify(action: str, entity: str, data: dict) -> str:
    """Execute a single modify operation. Returns result message."""
    section = _section_for_entity(entity)
    if section is not None and section not in settings_store.enabled_sections():
        return f"❌ Section '{section}' is disabled; enable it in settings to modify it."

    entity = entity.lower()
    data = normalize_data(data, entity)
    
    # === PROFILE-BASED ENTITIES ===
    if entity == "email":
        profile = load_json("profile.json")
        emails = profile.setdefault("contact", {}).setdefault("emails", [])
        address = get_field(data, "address", "email", "email_address")
        purpose = get_field(data, "purpose", "type", "category")
        
        if action == "add":
            if not address or not purpose:
                return "❌ Email requires 'address' and 'purpose'"
            if any(e.get("address", "").lower() == address.lower() for e in emails):
                return f"ℹ️ Email '{address}' already exists"
            emails.append({"address": address, "purpose": purpose})
            save_json("profile.json", profile)
            return f"✅ Added email: {address}"
        elif action == "update":
            idx, email = find_in_array(emails, address or "", "address")
            if idx == -1:
                return f"❌ Email '{address}' not found"
            new_address = get_field(data, "new_address", "new_email")
            if new_address:
                email["address"] = new_address
            if purpose:
                email["purpose"] = purpose
            save_json("profile.json", profile)
            return f"✅ Updated email"
        elif action == "remove":
            idx, _ = find_in_array(emails, address or "", "address")
            if idx == -1:
                return f"❌ Email '{address}' not found"
            emails.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed email: {address}"
    
    elif entity == "link":
        profile = load_json("profile.json")
        links = profile.setdefault("contact", {}).setdefault("links", [])
        url = get_field(data, "url", "link", "href", "website")
        label = get_field(data, "label", "name", "title", "platform")
        
        if action == "add":
            if not url or not label:
                return "❌ Link requires 'url' and 'label'"
            if any(l.get("label", "").lower() == label.lower() for l in links):
                return f"ℹ️ Link '{label}' already exists"
            links.append({"url": url, "label": label})
            save_json("profile.json", profile)
            return f"✅ Added link: {label}"
        elif action == "remove":
            idx, _ = find_in_array(links, label or "", "label")
            if idx == -1:
                return f"❌ Link '{label}' not found"
            links.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed link: {label}"
    
    elif entity == "language":
        profile = load_json("profile.json")
        languages = profile.setdefault("languages_spoken", [])
        name = get_field(data, "name", "language", "language_name", "lang")
        fluency = get_field(data, "fluency", "level", "proficiency")
        
        if action == "add":
            if not name or not fluency:
                return "❌ Language requires 'name' and 'fluency'"
            if any(l.get("name", "").lower() == name.lower() for l in languages):
                return f"ℹ️ Language '{name}' already exists"
            languages.append({"name": name, "fluency": fluency})
            save_json("profile.json", profile)
            return f"✅ Added language: {name} ({fluency})"
        elif action == "update":
            idx, lang = find_in_array(languages, name or "", "name")
            if idx == -1:
                return f"❌ Language '{name}' not found"
            if fluency:
                lang["fluency"] = fluency
            save_json("profile.json", profile)
            return f"✅ Updated {name} fluency"
        elif action == "remove":
            idx, _ = find_in_array(languages, name or "", "name")
            if idx == -1:
                return f"❌ Language '{name}' not found"
            languages.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed language: {name}"
    
    elif entity == "work_experience":
        profile = load_json("profile.json")
        work = profile.setdefault("work_experience", [])
        
        if action == "add":
            if not all(data.get(f) for f in ["role", "company", "type", "period"]):
                return "❌ Work experience requires 'role', 'company', 'type', 'period'"
            work.append({
                "role": data["role"],
                "company": data["company"],
                "type": data["type"],
                "period": data["period"],
                "highlights": data.get("highlights", [])
            })
            save_json("profile.json", profile)
            return f"✅ Added work experience: {data['role']} at {data['company']}"
        elif action == "update":
            idx, exp = find_in_array(work, data.get("company", ""), "company")
            if idx == -1:
                return f"❌ Work experience at '{data.get('company')}' not found"
            for field in ["role", "type", "period"]:
                if data.get(field):
                    exp[field] = data[field]
            save_json("profile.json", profile)
            return f"✅ Updated work experience at {data['company']}"
        elif action == "remove":
            idx, _ = find_in_array(work, data.get("company", ""), "company")
            if idx == -1:
                return f"❌ Work experience at '{data.get('company')}' not found"
            work.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed work experience at {data['company']}"
    
    elif entity == "work_highlight":
        profile = load_json("profile.json")
        work = profile.get("work_experience", [])
        company = get_field(data, "company", "work", "employer", "organization", default="")
        if not company:
            return "❌ Work highlight requires 'company' to identify which work experience"
        idx, exp = find_in_array(work, company, "company")
        if idx == -1:
            return f"❌ Work experience at '{company}' not found"
        highlights = exp.setdefault("highlights", [])
        if action == "add":
            new_highlights = data.get("highlights", [])
            if not new_highlights:
                single = get_field(data, "highlight", "item", "achievement", default="")
                if single:
                    new_highlights = [single]
            if not new_highlights:
                return "❌ Work highlight requires 'highlight' or 'highlights'"
            added = []
            for h in new_highlights:
                if h and h not in highlights:
                    highlights.append(h)
                    added.append(h)
            save_json("profile.json", profile)
            if len(added) == 1:
                return f"✅ Added highlight to {company}: {added[0]}"
            return f"✅ Added {len(added)} highlights to {company}"
        elif action == "remove":
            highlight = get_field(data, "highlight", "item", default="")
            if highlight in highlights:
                highlights.remove(highlight)
                save_json("profile.json", profile)
                return f"✅ Removed highlight from {company}"
            return f"❌ Highlight not found"
    
    elif entity == "career_aspiration":
        profile = load_json("profile.json")
        aspirations = profile.setdefault("career_aspirations", [])
        if action == "add":
            asp = data.get("aspiration", "")
            if asp in aspirations:
                return f"ℹ️ '{asp}' already in aspirations"
            aspirations.append(asp)
            save_json("profile.json", profile)
            return f"✅ Added aspiration: {asp}"
        elif action == "remove":
            asp = data.get("aspiration", "")
            found = next((a for a in aspirations if a.lower() == asp.lower()), None)
            if not found:
                return f"❌ Aspiration '{asp}' not found"
            aspirations.remove(found)
            save_json("profile.json", profile)
            return f"✅ Removed aspiration: {asp}"

    elif entity == "basic_info":
        profile = load_json("profile.json")
        if action == "update":
            fields = ["name", "preferred_name", "current_role", "organisation",
                      "location", "nationality", "bio"]
            updated = []
            for field in fields:
                if data.get(field):
                    profile[field] = data[field]
                    updated.append(f"{field}={data[field]}")
            if not updated:
                return f"❌ basic_info update requires at least one of: {', '.join(fields)}"
            save_json("profile.json", profile)
            return f"✅ Updated profile: {', '.join(updated)}"
        return "❌ basic_info only supports 'update' action"

    elif entity == "education":
        profile = load_json("profile.json")
        education = profile.setdefault("education", [])
        if action == "add":
            if not data.get("institution"):
                return "❌ Education requires 'institution'"
            if any(e.get("institution", "").lower() == data["institution"].lower() for e in education):
                return f"ℹ️ Education at '{data['institution']}' already exists"
            education.append({
                "institution": data["institution"],
                "degree_level": data.get("degree_level", ""),
                "field_of_study": data.get("field_of_study", ""),
                "start_year": data.get("start_year", ""),
                "end_year": data.get("end_year", ""),
                "status": data.get("status", "current"),
                "coursework": data.get("coursework", []),
                "clubs": data.get("clubs", []),
                "highlights": data.get("highlights", [])
            })
            save_json("profile.json", profile)
            return f"✅ Added education: {data['institution']}"
        elif action == "update":
            idx, edu = find_in_array(education, data.get("institution", ""), "institution")
            if idx == -1:
                return f"❌ Education at '{data.get('institution')}' not found"
            for field in ["degree_level", "field_of_study", "start_year", "end_year", "status"]:
                if data.get(field):
                    edu[field] = data[field]
            save_json("profile.json", profile)
            return f"✅ Updated education: {data['institution']}"
        elif action == "remove":
            idx, _ = find_in_array(education, data.get("institution", ""), "institution")
            if idx == -1:
                return f"❌ Education not found"
            education.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed education: {data['institution']}"
    
    # === LIFESTYLE-BASED ENTITIES ===
    elif entity == "hobby":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.setdefault("hobbies", [])
        name = get_field(data, "name", "hobby", "hobby_name", "title", "activity")
        skill_level = get_field(data, "skill_level", "level", "proficiency", default="enthusiast")
        status = get_field(data, "status", "state", "is_active", default="active")
        if status in ["inactive", "stopped", "paused", "not_active", "false", False]:
            status = "inactive"
        else:
            status = "active"
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Hobby requires a name"
            if any(h.get("name", "").lower() == name.lower() for h in hobbies):
                return f"ℹ️ Hobby '{name}' already exists"
            hobbies.append({
                "id": generate_entity_id("hobby"), "name": name, "skill_level": skill_level,
                "status": status, "notes": notes, "specifics": data.get("specifics", []), "references": []
            })
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added hobby: {name} (status: {status})"
        elif action == "update":
            idx, hobby = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            if data.get("skill_level") or data.get("level") or data.get("proficiency"):
                hobby["skill_level"] = skill_level
            if data.get("status") or data.get("state") or data.get("is_active") is not None:
                hobby["status"] = status
            if notes:
                hobby["notes"] = notes
            if "specifics" in data:
                hobby["specifics"] = data["specifics"]
            if "references" in data:
                hobby["references"] = data["references"]
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("lifestyle.json", lifestyle)
            return f"✅ Updated hobby: {name}"
        elif action == "remove":
            idx, _ = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            hobbies.pop(idx)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed hobby: {name}"
    
    elif entity == "passion":
        lifestyle = load_json("lifestyle.json")
        passions = lifestyle.setdefault("passions", [])
        item = get_field(data, "passion", "name", "interest", "topic", default="")
        if action == "add":
            if not item:
                return "❌ Passion requires 'passion' or 'name'"
            if item in passions:
                return f"ℹ️ '{item}' already in passions"
            passions.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added passion: {item}"
        elif action == "remove":
            found = next((p for p in passions if p.lower() == item.lower()), None)
            if not found:
                return f"❌ Passion not found"
            passions.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed passion: {item}"
    
    elif entity == "curiosity":
        lifestyle = load_json("lifestyle.json")
        curiosities = lifestyle.setdefault("curiosities", [])
        item = get_field(data, "curiosity", "topic", "subject", "interest", "name", default="")
        if action == "add":
            if not item:
                return "❌ Curiosity requires 'curiosity' or 'topic'"
            if item in curiosities:
                return f"ℹ️ '{item}' already in curiosities"
            curiosities.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added curiosity: {item}"
        elif action == "remove":
            found = next((c for c in curiosities if c.lower() == item.lower()), None)
            if not found:
                return f"❌ Curiosity not found"
            curiosities.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed curiosity: {item}"
    
    elif entity == "personality_trait":
        lifestyle = load_json("lifestyle.json")
        traits = lifestyle.setdefault("personality_traits", [])
        item = get_field(data, "trait", "personality_trait", "characteristic", "quality", "name", default="")
        if action == "add":
            if not item:
                return "❌ Personality trait requires 'trait' or 'name'"
            if item in traits:
                return f"ℹ️ '{item}' already in traits"
            traits.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added trait: {item}"
        elif action == "remove":
            found = next((t for t in traits if t.lower() == item.lower()), None)
            if not found:
                return f"❌ Trait not found"
            traits.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed trait: {item}"
    
    elif entity == "value":
        lifestyle = load_json("lifestyle.json")
        values = lifestyle.setdefault("values", [])
        item = get_field(data, "value", "core_value", "belief", "principle", "name", default="")
        if action == "add":
            if not item:
                return "❌ Value requires 'value' or 'name'"
            if item in values:
                return f"ℹ️ '{item}' already in values"
            values.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added value: {item}"
        elif action == "remove":
            found = next((v for v in values if v.lower() == item.lower()), None)
            if not found:
                return f"❌ Value not found"
            values.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed value: {item}"
    
    # === KNOWLEDGE-BASED ENTITIES ===
    elif entity == "domain":
        knowledge = load_json("knowledge.json")
        domains = knowledge.setdefault("domains", [])
        name = get_field(data, "name", "domain", "domain_name", "area", "topic")
        level = get_field(data, "level", "proficiency", "skill_level", default="learning")
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Domain requires 'name' or 'domain'"
            if any(d.get("name", "").lower() == name.lower() for d in domains):
                return f"ℹ️ Domain '{name}' already exists"
            domains.append({
                "id": generate_entity_id("domain"), "name": name, "level": level,
                "notes": notes, "references": data.get("references", [])
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added domain: {name}"
        elif action == "update":
            idx, domain = find_in_array(domains, name or "", "name")
            if idx == -1:
                return f"❌ Domain '{name}' not found"
            if level != "learning" or data.get("level"):
                domain["level"] = level
            if notes:
                domain["notes"] = notes
            save_json("knowledge.json", knowledge)
            return f"✅ Updated domain: {name}"
        elif action == "remove":
            idx, _ = find_in_array(domains, name or "", "name")
            if idx == -1:
                return f"❌ Domain not found"
            domains.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed domain: {name}"
    
    elif entity == "mental_tab":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.setdefault("mental_tabs", [])
        topic = get_field(data, "title", "topic", "name", "mental_tab", "subject")
        context = get_field(data, "context", "notes", "description", "details", default="")
        status = get_field(data, "status", "state", default="open")
        
        if action == "add":
            if not topic:
                return "❌ Mental tab requires 'title' or 'topic'"
            if any((t.get("title", "") or t.get("topic", "")).lower() == topic.lower() for t in tabs):
                return f"ℹ️ Mental tab '{topic}' already exists"
            tabs.append({
                "title": topic, "notes": context, "tags": data.get("tags", []),
                "status": status, "references": data.get("references", []),
                "created_at": datetime.now().isoformat() + "Z"
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added mental tab: {topic}"
        elif action == "update":
            idx, tab = find_in_array(tabs, topic or "", "title")
            if idx == -1:
                idx, tab = find_in_array(tabs, topic or "", "topic")
            if idx == -1:
                return f"❌ Mental tab '{topic}' not found"
            if context:
                tab["notes"] = context
            if status != "open" or data.get("status"):
                tab["status"] = status
            if data.get("tags"):
                tab["tags"] = data["tags"]
            save_json("knowledge.json", knowledge)
            return f"✅ Updated mental tab: {topic}"
        elif action == "remove":
            idx, _ = find_in_array(tabs, topic or "", "title")
            if idx == -1:
                idx, _ = find_in_array(tabs, topic or "", "topic")
            if idx == -1:
                return f"❌ Mental tab not found"
            tabs.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed mental tab: {topic}"
    
    # === PROJECTS-BASED ENTITIES ===
    elif entity == "project":
        projects = load_json("projects.json")
        project_list = projects.setdefault("projects", [])
        name = get_field(data, "name", "project", "project_name", "title")
        description = get_field(data, "description", "desc", "summary", default="")
        status = get_field(data, "status", "state", "progress", default="planning")
        notes = get_field(data, "notes", "details", default="")
        
        if action == "add":
            if not name or not description:
                return "❌ Project requires 'name' and 'description'"
            if any(p.get("name", "").lower() == name.lower() for p in project_list):
                return f"ℹ️ Project '{name}' already exists"
            project_list.append({
                "id": generate_entity_id("project"), "name": name, "description": description,
                "status": status, "tags": data.get("tags", []), "references": data.get("references", []),
                "highlights": data.get("highlights", []), "notes": notes,
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            save_json("projects.json", projects)
            return f"✅ Added project: {name}"
        elif action == "update":
            idx, project = find_in_array(project_list, name or "", "name")
            if idx == -1:
                return f"❌ Project '{name}' not found"
            for field in ["description", "status", "url", "tags", "references", "highlights", "notes", "challenges", "goals"]:
                if data.get(field):
                    project[field] = data[field]
            project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("projects.json", projects)
            return f"✅ Updated project: {name}"
        elif action == "remove":
            idx, _ = find_in_array(project_list, name or "", "name")
            if idx == -1:
                return f"❌ Project '{name}' not found"
            project_list.pop(idx)
            save_json("projects.json", projects)
            return f"✅ Removed project: {name}"
    
    elif entity == "current_learning":
        projects = load_json("projects.json")
        learning = projects.setdefault("current_learning", [])
        topic = get_field(data, "topic", "name", "subject", "item", "learning")
        context = get_field(data, "context", "description", "reason", "why", default="")
        priority = get_field(data, "priority", "level", "importance", default="medium")
        
        if action == "add":
            if not topic:
                return "❌ Current learning requires 'topic'"
            if any(l.get("topic", "").lower() == topic.lower() for l in learning):
                return f"ℹ️ Learning topic '{topic}' already exists"
            learning.append({"topic": topic, "context": context, "priority": priority})
            save_json("projects.json", projects)
            return f"✅ Added learning: {topic}"
        elif action == "update":
            idx, item = find_in_array(learning, topic or "", "topic")
            if idx == -1:
                return f"❌ Learning topic '{topic}' not found"
            if context:
                item["context"] = context
            if priority:
                item["priority"] = priority
            save_json("projects.json", projects)
            return f"✅ Updated learning: {topic}"
        elif action == "remove":
            idx, _ = find_in_array(learning, topic or "", "topic")
            if idx == -1:
                return f"❌ Learning topic '{topic}' not found"
            learning.pop(idx)
            save_json("projects.json", projects)
            return f"✅ Removed learning: {topic}"
    
    elif entity == "top_of_mind":
        projects = load_json("projects.json")
        tom = projects.setdefault("top_of_mind", [])
        item = get_field(data, "item", "topic", "thought", "subject", "name", "idea", default="")
        note = data.get("note", "")
        
        def get_idea_text(t):
            return t.get("idea", "") if isinstance(t, dict) else t
        
        if action == "add":
            if not item:
                return "❌ Top of mind requires 'item', 'idea', or 'topic'"
            existing = next((t for t in tom if get_idea_text(t).lower() == item.lower()), None)
            if existing:
                return f"ℹ️ '{item}' already top of mind"
            tom.append({"idea": item, "note": note})
            save_json("projects.json", projects)
            return f"✅ Added to top of mind: {item}"
        elif action == "remove":
            found = next((t for t in tom if get_idea_text(t).lower() == item.lower()), None)
            if not found:
                return f"❌ '{item}' not in top of mind"
            tom.remove(found)
            save_json("projects.json", projects)
            return f"✅ Removed from top of mind: {item}"
    
    # === PREFERENCES ===
    elif entity == "dislike":
        preferences = load_json("preferences.json")
        dislikes = preferences.setdefault("dislikes", [])
        item = get_field(data, "dislike", "item", "thing", "name", "what", default="")
        if action == "add":
            if not item:
                return "❌ Dislike requires 'dislike' or 'item'"
            if any(d.lower() == item.lower() for d in dislikes):
                return f"ℹ️ '{item}' already in dislikes"
            dislikes.append(item)
            save_json("preferences.json", preferences)
            return f"✅ Added dislike: {item}"
        elif action == "remove":
            found = next((d for d in dislikes if d.lower() == item.lower()), None)
            if not found:
                return f"❌ Dislike '{item}' not found"
            dislikes.remove(found)
            save_json("preferences.json", preferences)
            return f"✅ Removed dislike: {item}"
    
    # === CIRCLE ===
    elif entity == "connection":
        circle = load_json("circle.json")
        if "error" in circle:
            circle = {"connections": []}
        connections = circle.setdefault("connections", [])
        name = get_field(data, "name", "person", "contact", "connection_name")
        relationship = get_field(data, "relationship")
        traits = data.get("traits", [])
        notes = data.get("notes", "")
        
        if action == "add":
            if not name:
                return "❌ Connection requires 'name'"
            if any(c.get("name", "").lower() == name.lower() for c in connections):
                return f"ℹ️ Connection '{name}' already exists"
            new_connection = {"id": generate_entity_id("connection"), "name": name}
            if relationship:
                new_connection["relationship"] = relationship
            if traits:
                new_connection["traits"] = traits if isinstance(traits, list) else [traits]
            if notes:
                new_connection["notes"] = notes
            connections.append(new_connection)
            save_json("circle.json", circle)
            return f"✅ Added connection: {name}"
        elif action == "update":
            idx, connection = find_in_array(connections, name or "", "name")
            if idx == -1:
                return f"❌ Connection '{name}' not found"
            if relationship:
                connection["relationship"] = relationship
            if "traits" in data:
                connection["traits"] = traits if isinstance(traits, list) else [traits]
            if "notes" in data:
                connection["notes"] = notes
            save_json("circle.json", circle)
            return f"✅ Updated connection: {name}"
        elif action == "remove":
            idx, _ = find_in_array(connections, name or "", "name")
            if idx == -1:
                return f"❌ Connection '{name}' not found"
            connections.pop(idx)
            save_json("circle.json", circle)
            return f"✅ Removed connection: {name}"
    
    # === LEARNING LOG ===
    elif entity == "learning_entry":
        log = load_json("learning_log.json")
        if "error" in log:
            log = {"entries": []}
        entries = log.setdefault("entries", [])
        
        if action == "add":
            if not data.get("topic") or not data.get("details"):
                return "❌ Learning entry requires 'topic' and 'details'"
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
            entry_id = f"learn_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:6]}"
            entry = {
                "id": entry_id, "topic": data["topic"], "details": data["details"],
                "source": data.get("source", "conversation"), "tags": data.get("tags", []),
                "timestamp": datetime.now().isoformat()
            }
            if data.get("conversation_metadata"):
                entry["conversation_metadata"] = data["conversation_metadata"]
            if data.get("key_decisions"):
                entry["key_decisions"] = data["key_decisions"]
            if data.get("followup_items"):
                entry["followup_items"] = data["followup_items"]
            if data.get("related_entries"):
                entry["related_entries"] = data["related_entries"]
            entries.append(entry)
            save_json("learning_log.json", log)
            return f"✅ Logged learning: {data['topic']} (id: {entry_id})"
        elif action == "update":
            entry_id = data.get("id", "")
            topic = data.get("topic", "")
            if not entry_id and not topic:
                return "❌ Learning log update requires 'id' or 'topic'"
            target = None
            for entry in reversed(entries):
                if (entry_id and entry.get("id") == entry_id) or \
                   (not entry_id and topic and entry.get("topic", "").lower() == topic.lower()):
                    target = entry
                    break
            if target is None:
                return f"❌ Learning entry not found: {entry_id or topic}"
            if data.get("related_entries"):
                err = _validate_related_entries(data["related_entries"])
                if err:
                    return err
            updated = []
            for field in ("details", "source", "tags", "key_decisions",
                          "followup_items", "conversation_metadata", "related_entries"):
                if data.get(field):
                    target[field] = data[field]
                    updated.append(field)
            if data.get("new_topic"):
                target["topic"] = data["new_topic"]
                updated.append("topic")
            if not updated:
                return ("❌ Learning log update requires at least one of: details, source, tags, "
                        "key_decisions, followup_items, conversation_metadata, related_entries, new_topic")
            save_json("learning_log.json", log)
            return f"✅ Updated learning entry: {target.get('topic', entry_id)} ({', '.join(updated)})"
        elif action == "remove":
            topic = data.get("topic", "")
            entry_id = data.get("id", "")
            for i in range(len(entries) - 1, -1, -1):
                if (entry_id and entries[i].get("id") == entry_id) or \
                   (topic and entries[i].get("topic", "").lower() == topic.lower()):
                    removed = entries.pop(i)
                    save_json("learning_log.json", log)
                    return f"✅ Removed learning entry: {removed.get('topic', entry_id)}"
            return f"❌ Learning entry not found: {topic or entry_id}"
    
    # === HOBBY EXTRAS (references and specifics) ===
    elif entity == "hobby_reference":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.get("hobbies", [])
        hobby_name = get_field(data, "hobby_name", "hobby", "parent", "for_hobby")
        idx, hobby = find_in_array(hobbies, hobby_name or "", "name")
        if idx == -1:
            return f"❌ Hobby '{hobby_name}' not found"
        
        refs = hobby.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        
        if action == "add":
            if not ref_name:
                return "❌ Reference requires 'ref_name' or 'name'"
            refs.append({
                "name": ref_name,
                "url": get_field(data, "url", "link", "href", default=""),
                "notes": get_field(data, "notes", "description", default="")
            })
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added reference to {hobby_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            for field in ["url", "notes"]:
                if data.get(field):
                    ref[field] = data[field]
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("lifestyle.json", lifestyle)
            return f"✅ Updated reference in {hobby_name}"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            refs.pop(ref_idx)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed reference from {hobby_name}"
    
    elif entity == "hobby_specific":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.get("hobbies", [])
        hobby_name = get_field(data, "hobby_name", "hobby", "parent", "for_hobby")
        idx, hobby = find_in_array(hobbies, hobby_name or "", "name")
        if idx == -1:
            return f"❌ Hobby '{hobby_name}' not found"
        
        specifics = hobby.setdefault("specifics", [])
        specific_val = get_field(data, "specific", "value", "item", "detail")
        if action == "add":
            if specific_val:
                specifics.append(specific_val)
                save_json("lifestyle.json", lifestyle)
                return f"✅ Added specific to {hobby_name}"
            return "❌ Specific requires 'specific' or 'value'"
        elif action == "remove":
            if specific_val in specifics:
                specifics.remove(specific_val)
                save_json("lifestyle.json", lifestyle)
                return f"✅ Removed specific from {hobby_name}"
            return f"❌ Specific not found"
    
    # === GENERAL PREFERENCE (key-value category system) ===
    elif entity == "preference":
        preferences = load_json("preferences.json")
        category = get_field(data, "category", "type", default="general")
        cat_prefs = preferences.setdefault(category, {})
        key = get_field(data, "key", "setting", "option", "preference")
        value = get_field(data, "value", "setting_value", default="")
        
        if action in ["add", "update"]:
            if not key:
                return "❌ Preference requires 'key'"
            cat_prefs[key] = value
            save_json("preferences.json", preferences)
            return f"✅ Set {category}.{key}"
        elif action == "remove":
            if key not in cat_prefs:
                return f"❌ Preference '{key}' not found in {category}"
            del cat_prefs[key]
            save_json("preferences.json", preferences)
            return f"✅ Removed {category}.{key}"
    
    # === COMMUNICATION PREFERENCES ===
    elif entity == "communication_default":
        preferences = load_json("preferences.json")
        comm = preferences.setdefault("communication", {})
        default = comm.setdefault("default", {"tone": "", "detail_level": "", "locale": "British English"})
        
        if action == "update":
            updated = []
            if data.get("tone"):
                default["tone"] = data["tone"]
                updated.append(f"tone={data['tone']}")
            if data.get("detail_level"):
                default["detail_level"] = data["detail_level"]
                updated.append(f"detail_level={data['detail_level']}")
            if data.get("locale"):
                default["locale"] = data["locale"]
                updated.append(f"locale={data['locale']}")
            if not updated:
                return "❌ communication_default update requires 'tone', 'detail_level', or 'locale'"
            save_json("preferences.json", preferences)
            return f"✅ Updated default communication: {', '.join(updated)}"
        return f"❌ communication_default only supports 'update' action"
    
    elif entity == "mood_override":
        preferences = load_json("preferences.json")
        comm = preferences.setdefault("communication", {})
        overrides = comm.setdefault("mood_overrides", [])
        mood = get_field(data, "mood", "feeling", "state", "when", default="")
        
        if action == "add":
            if not mood:
                return "❌ mood_override requires 'mood' (e.g., 'stressed', 'tired', 'excited')"
            existing = next((o for o in overrides if o.get("mood", "").lower() == mood.lower()), None)
            if existing:
                if data.get("tone"):
                    existing["tone"] = data["tone"]
                if data.get("detail_level"):
                    existing["detail_level"] = data["detail_level"]
                save_json("preferences.json", preferences)
                return f"✅ Updated mood override for '{mood}'"
            override = {"mood": mood}
            if data.get("tone"):
                override["tone"] = data["tone"]
            if data.get("detail_level"):
                override["detail_level"] = data["detail_level"]
            if len(override) == 1:
                return "❌ mood_override needs at least 'tone' or 'detail_level'"
            overrides.append(override)
            save_json("preferences.json", preferences)
            return f"✅ Added mood override: when {mood} → {override}"
        elif action == "remove":
            if not mood:
                return "❌ mood_override remove requires 'mood'"
            found = next((o for o in overrides if o.get("mood", "").lower() == mood.lower()), None)
            if not found:
                return f"❌ No mood override for '{mood}'"
            overrides.remove(found)
            save_json("preferences.json", preferences)
            return f"✅ Removed mood override for '{mood}'"
        elif action == "update":
            if not mood:
                return "❌ mood_override update requires 'mood'"
            existing = next((o for o in overrides if o.get("mood", "").lower() == mood.lower()), None)
            if not existing:
                return f"❌ No mood override for '{mood}' to update"
            if data.get("tone"):
                existing["tone"] = data["tone"]
            if data.get("detail_level"):
                existing["detail_level"] = data["detail_level"]
            save_json("preferences.json", preferences)
            return f"✅ Updated mood override for '{mood}'"
    
    # === WELLNESS ENTITIES ===
    elif entity == "sleep":
        lifestyle = load_json("lifestyle.json")
        wellness = lifestyle.setdefault("wellness", {})
        sleep = wellness.setdefault("sleep", {
            "weekday": {"bedtime": "", "wakeup": ""},
            "weekend": {"bedtime": "", "wakeup": ""}
        })
        day_type = get_field(data, "day_type", "type", "day", "when", default="weekday")
        bedtime = get_field(data, "bedtime", "bed_time", "sleep_time", "sleep", default=None)
        wakeup = get_field(data, "wakeup", "wake_up", "wake_time", "wake", "rise", default=None)
        
        if action == "update":
            if day_type not in ["weekday", "weekend"]:
                return f"❌ day_type must be 'weekday' or 'weekend', got '{day_type}'"
            day_sleep = sleep.setdefault(day_type, {"bedtime": "", "wakeup": ""})
            if bedtime is not None:
                day_sleep["bedtime"] = bedtime
            if wakeup is not None:
                day_sleep["wakeup"] = wakeup
            save_json("lifestyle.json", lifestyle)
            updated = []
            if bedtime: updated.append(f"bedtime={bedtime}")
            if wakeup: updated.append(f"wakeup={wakeup}")
            return f"✅ Updated {day_type} sleep: {', '.join(updated)}"
        return f"❌ Sleep only supports 'update' action"
    
    elif entity == "energy_peak":
        lifestyle = load_json("lifestyle.json")
        wellness = lifestyle.setdefault("wellness", {})
        peaks = wellness.setdefault("energy_peaks", [])
        item = get_field(data, "peak", "energy_peak", "time", "when", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Energy peak requires 'peak' or 'time'"
            if any(p.lower() == item.lower() for p in peaks):
                return f"ℹ️ '{item}' already in energy peaks"
            peaks.append(item)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added energy peak: {item}"
        elif action == "remove":
            found = next((p for p in peaks if p.lower() == item.lower()), None)
            if not found:
                return f"❌ Energy peak '{item}' not found"
            peaks.remove(found)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed energy peak: {item}"
    
    # === PROJECT EXTRAS ===
    elif entity == "project_tag":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project")
        idx, project = find_in_array(project_list, project_name or "", "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        tags = project.setdefault("tags", [])
        tag = get_field(data, "tag", "label", "value")
        if action == "add":
            if tag and tag not in tags:
                tags.append(tag)
                save_json("projects.json", projects)
                return f"✅ Added tag '{tag}' to {project_name}"
            return f"ℹ️ Tag '{tag}' already exists"
        elif action == "remove":
            if tag in tags:
                tags.remove(tag)
                save_json("projects.json", projects)
                return f"✅ Removed tag '{tag}' from {project_name}"
            return f"❌ Tag not found"
    
    elif entity == "project_reference":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project")
        idx, project = find_in_array(project_list, project_name or "", "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        refs = project.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("projects.json", projects)
            return f"✅ Added reference to {project_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            save_json("projects.json", projects)
            return f"✅ Updated reference"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("projects.json", projects)
            return f"✅ Removed reference"
    
    elif entity == "project_highlight":
        projects = load_json("projects.json")
        project_list = projects.get("projects", [])
        project_name = get_field(data, "project_name", "project", "for_project", "parent")
        if not project_name:
            return "❌ Project highlight requires 'project_name' to identify which project"
        idx, project = find_in_array(project_list, project_name, "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"
        
        highlights = project.setdefault("highlights", [])
        if action == "add":
            new_highlights = data.get("highlights", [])
            if not new_highlights:
                single = get_field(data, "highlight", "item", "achievement", default="")
                if single:
                    new_highlights = [single]
            if not new_highlights:
                return "❌ Project highlight requires 'highlight' or 'highlights'"
            added = []
            for h in new_highlights:
                if h and h not in highlights:
                    highlights.append(h)
                    added.append(h)
            project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("projects.json", projects)
            if len(added) == 1:
                return f"✅ Added highlight to {project_name}: {added[0]}"
            return f"✅ Added {len(added)} highlights to {project_name}"
        elif action == "remove":
            highlight = get_field(data, "highlight", "item", default="")
            if highlight in highlights:
                highlights.remove(highlight)
                project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
                save_json("projects.json", projects)
                return f"✅ Removed highlight from {project_name}"
            return f"❌ Highlight not found"
    
    # === KNOWLEDGE EXTRAS ===
    elif entity == "knowledge":
        knowledge = load_json("knowledge.json")
        category = get_field(data, "category", "type", default="domains")
        items = knowledge.setdefault(category, [])
        name = get_field(data, "name", "topic", "domain", "subject", "area")
        level = get_field(data, "level", "proficiency", "skill_level", default="learning")
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Knowledge requires 'name' or 'topic'"
            if any(isinstance(k, dict) and k.get("name", "").lower() == name.lower() for k in items):
                return f"ℹ️ '{name}' already exists in {category}"
            items.append({
                "name": name, "level": level, "notes": notes,
                "references": data.get("references", []),
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added {name} to {category}"
        elif action == "update":
            idx, item = find_in_array(items, name or "", "name")
            if idx == -1:
                return f"❌ '{name}' not found in {category}"
            if level != "learning" or data.get("level"):
                item["level"] = level
            if notes:
                item["notes"] = notes
            item["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("knowledge.json", knowledge)
            return f"✅ Updated {name} in {category}"
        elif action == "remove":
            idx, _ = find_in_array(items, data.get("name", ""), "name")
            if idx == -1:
                return f"❌ '{name}' not found in {category}"
            items.pop(idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed {name} from {category}"
    
    elif entity == "domain_reference":
        knowledge = load_json("knowledge.json")
        domains = knowledge.get("domains", [])
        domain_name = get_field(data, "domain_name", "domain", "for_domain", "parent")
        idx, domain = find_in_array(domains, domain_name or "", "name")
        if idx == -1:
            return f"❌ Domain '{domain_name}' not found"
        
        refs = domain.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "title")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("knowledge.json", knowledge)
            return f"✅ Added reference to {domain_name}"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("knowledge.json", knowledge)
            return f"✅ Updated reference in {domain_name}"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed reference"
    
    elif entity == "mental_tab_reference":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.get("mental_tabs", [])
        topic = get_field(data, "title", "topic", "mental_tab", "for_tab", "parent")
        idx, tab = find_in_array(tabs, topic or "", "title")
        if idx == -1:
            idx, tab = find_in_array(tabs, topic or "", "topic")
        if idx == -1:
            return f"❌ Mental tab '{topic}' not found"
        
        refs = tab.setdefault("references", [])
        ref_name = get_field(data, "ref_name", "name", "reference_name", "reference")
        ref_url = get_field(data, "url", "link", "href", default="")
        ref_notes = get_field(data, "notes", "description", default="")
        
        if action == "add":
            refs.append({"name": ref_name or "", "url": ref_url, "notes": ref_notes})
            save_json("knowledge.json", knowledge)
            return f"✅ Added reference to mental tab"
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            if ref_url:
                ref["url"] = ref_url
            if ref_notes:
                ref["notes"] = ref_notes
            new_name = get_field(data, "new_name", "new_ref_name")
            if new_name:
                ref["name"] = new_name
            save_json("knowledge.json", knowledge)
            return f"✅ Updated reference"
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference not found"
            refs.pop(ref_idx)
            save_json("knowledge.json", knowledge)
            return f"✅ Removed reference"
    
    # === EDUCATION EXTRAS ===
    elif entity == "education_highlight":
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"
        
        highlights = edu.setdefault("highlights", [])
        if action == "add":
            highlight = data.get("highlight", "")
            if highlight and highlight not in highlights:
                highlights.append(highlight)
                save_json("profile.json", profile)
                return f"✅ Added highlight to {data['institution']}"
            return "❌ Highlight requires 'highlight' field"
        elif action == "remove":
            if data.get("highlight") in highlights:
                highlights.remove(data["highlight"])
                save_json("profile.json", profile)
                return f"✅ Removed highlight"
            return f"❌ Highlight not found"
    
    elif entity == "coursework":
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"
        
        coursework = edu.setdefault("coursework", [])
        course = get_field(data, "course", "coursework", "class", "subject")
        
        if action == "add":
            if not course:
                return "❌ Coursework requires 'course' or 'coursework'"
            if course in coursework:
                return f"ℹ️ '{course}' already in coursework"
            coursework.append(course)
            save_json("profile.json", profile)
            return f"✅ Added coursework: {course}"
        elif action == "remove":
            if course in coursework:
                coursework.remove(course)
                save_json("profile.json", profile)
                return f"✅ Removed coursework: {course}"
            return f"❌ Coursework not found"
    
    elif entity == "coursework_topic":
        # Alias for coursework - same functionality
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"
        
        coursework = edu.setdefault("coursework", [])
        course = get_field(data, "course", "coursework", "topic", "subject")
        
        if action == "add":
            if not course:
                return "❌ Coursework topic requires 'course' or 'topic'"
            if course in coursework:
                return f"ℹ️ '{course}' already in coursework"
            coursework.append(course)
            save_json("profile.json", profile)
            return f"✅ Added coursework topic: {course}"
        elif action == "remove":
            if course in coursework:
                coursework.remove(course)
                save_json("profile.json", profile)
                return f"✅ Removed coursework topic: {course}"
            return f"❌ Coursework topic not found"
    
    return f"❌ Unknown entity type: {entity}"


# =============================================================================
# ENTITY SCHEMA - For LLM discovery
# =============================================================================

# Each entity carries an `identifier`: the field in `data` used to match an
# existing item on update/remove. Nested entities also carry a `parent`: the
# parent item's identifier field, which must be present in `data` too.
# Both are verified against execute_modify's actual matching logic.
ENTITY_SCHEMA = {
    "profile": {
        "email": {"actions": ["add", "update", "remove"], "required": ["address"], "optional": ["label"],
                 "identifier": "address"},
        "link": {"actions": ["add", "remove"], "required": ["url", "label"], "optional": [],
                "identifier": "label"},
        "language": {"actions": ["add", "update", "remove"], "required": ["name"], "optional": ["proficiency"],
                    "valid_values": {"proficiency": ["native", "fluent", "conversational", "basic"]},
                    "identifier": "name"},
        "work_experience": {"actions": ["add", "update", "remove"], "required": ["company"],
                           "optional": ["role", "period", "type", "location", "description", "highlights"],
                           "identifier": "company"},
        "work_highlight": {"actions": ["add", "remove"], "required": ["company", "highlight"], "optional": [],
                          "identifier": "highlight", "parent": "company"},
        "education": {"actions": ["add", "update", "remove"], "required": ["institution"],
                     "optional": ["degree", "field", "period", "highlights", "coursework", "clubs"],
                     "identifier": "institution"},
        "education_highlight": {"actions": ["add", "remove"], "required": ["institution", "highlight"], "optional": [],
                               "identifier": "highlight", "parent": "institution"},
        "coursework": {"actions": ["add", "remove"], "required": ["institution", "course"], "optional": [],
                      "identifier": "course", "parent": "institution"},
        "coursework_topic": {"actions": ["add", "remove"], "required": ["institution", "course"], "optional": [],
                            "identifier": "course", "parent": "institution"},
        "career_aspiration": {"actions": ["add", "remove"], "required": ["aspiration"], "optional": [],
                             "identifier": "aspiration"},
        "basic_info": {"actions": ["update"], "required": [],
                      "optional": ["name", "preferred_name", "current_role", "organisation",
                                   "location", "nationality", "bio"],
                      "identifier": None,
                      "description": "Update-only singleton for top-level profile fields"}
    },
    "lifestyle": {
        "hobby": {"actions": ["add", "update", "remove"], "required": ["name"],
                 "optional": ["skill_level", "status", "notes", "specifics", "references"],
                 "valid_values": {"skill_level": ["beginner", "learning", "intermediate", "advanced", "expert"],
                                 "status": ["active", "inactive", "paused"]},
                 "identifier": "name"},
        "hobby_reference": {"actions": ["add", "update", "remove"], "required": ["hobby_name", "ref_name"],
                           "optional": ["url", "notes"], "identifier": "ref_name", "parent": "hobby_name"},
        "hobby_specific": {"actions": ["add", "remove"], "required": ["hobby_name", "specific"], "optional": [],
                          "identifier": "specific", "parent": "hobby_name"},
        "passion": {"actions": ["add", "remove"], "required": ["name"], "optional": [], "identifier": "name"},
        "curiosity": {"actions": ["add", "remove"], "required": ["topic"], "optional": [], "identifier": "topic"},
        "personality_trait": {"actions": ["add", "remove"], "required": ["trait"], "optional": [],
                             "identifier": "trait"},
        "value": {"actions": ["add", "remove"], "required": ["value"], "optional": [], "identifier": "value"},
        "sleep": {"actions": ["update"], "required": ["day_type"], "optional": ["bedtime", "wakeup"],
                 "valid_values": {"day_type": ["weekday", "weekend"]}, "identifier": "day_type"},
        "energy_peak": {"actions": ["add", "remove"], "required": ["peak"], "optional": [], "identifier": "peak"}
    },
    "knowledge": {
        "domain": {"actions": ["add", "update", "remove"], "required": ["name"],
                  "optional": ["level", "notes", "references"],
                  "valid_values": {"level": ["beginner", "learning", "intermediate", "advanced", "expert"]},
                  "identifier": "name"},
        "domain_reference": {"actions": ["add", "update", "remove"], "required": ["domain_name", "ref_name"],
                            "optional": ["url", "notes"], "identifier": "ref_name", "parent": "domain_name"},
        "knowledge": {"actions": ["add", "update", "remove"], "required": ["name"],
                     "optional": ["category", "level", "notes", "references"],
                     "description": "Generic knowledge entry with category support", "identifier": "name"},
        "mental_tab": {"actions": ["add", "update", "remove"], "required": ["title"],
                      "optional": ["notes", "tags", "status", "references"],
                      "valid_values": {"status": ["open", "closed", "archived"]}, "identifier": "title"},
        "mental_tab_reference": {"actions": ["add", "update", "remove"], "required": ["title", "ref_name"],
                                "optional": ["url", "notes"], "identifier": "ref_name", "parent": "title"}
    },
    "projects": {
        "project": {"actions": ["add", "update", "remove"], "required": ["name"],
                   "optional": ["description", "status", "tags", "notes", "highlights", "references"],
                   "valid_values": {"status": ["active", "paused", "completed", "archived", "idea"]},
                   "identifier": "name"},
        "project_tag": {"actions": ["add", "remove"], "required": ["project_name", "tag"], "optional": [],
                       "identifier": "tag", "parent": "project_name"},
        "project_reference": {"actions": ["add", "update", "remove"], "required": ["project_name", "ref_name"],
                             "optional": ["url", "notes"], "identifier": "ref_name", "parent": "project_name"},
        "project_highlight": {"actions": ["add", "remove"], "required": ["project_name", "highlight"], "optional": [],
                             "identifier": "highlight", "parent": "project_name"},
        "current_learning": {"actions": ["add", "update", "remove"], "required": ["topic"],
                            "optional": ["context", "priority"],
                            "valid_values": {"priority": ["low", "medium", "high"]}, "identifier": "topic"},
        "top_of_mind": {"actions": ["add", "remove"], "required": ["item"], "optional": ["note"],
                       "identifier": "item"}
    },
    "circle": {
        "connection": {"actions": ["add", "update", "remove"], "required": ["name"],
                      "optional": ["relationship", "traits", "notes", "contact"], "identifier": "name"}
    },
    "preferences": {
        "dislike": {"actions": ["add", "remove"], "required": ["dislike"], "optional": [], "identifier": "dislike"},
        "preference": {"actions": ["add", "update", "remove"], "required": ["key"],
                      "optional": ["category", "value"],
                      "description": "Generic key-value preference with category support", "identifier": "key"},
        "communication_default": {"actions": ["update"], "required": [],
                                 "optional": ["tone", "detail_level", "locale"], "identifier": None,
                                 "description": "Update-only singleton for default communication style"},
        "mood_override": {"actions": ["add", "update", "remove"], "required": ["mood"],
                         "optional": ["tone", "detail_level"], "identifier": "mood"}
    },
    "learning_log": {
        "learning_entry": {"actions": ["add", "update", "remove"], "required": ["topic", "details"],
                          "optional": ["source", "tags", "conversation_metadata", "key_decisions",
                                       "followup_items", "new_topic", "related_entries"],
                          "identifier": "topic"}
    }
}


def _section_for_entity(entity: str):
    """The registry section (file_type) an entity writes to, or None if unknown."""
    entity = entity.lower()
    for file_name, entities in ENTITY_SCHEMA.items():
        if entity in entities:
            return file_name
    return None


# Usage instructions embedded in every get_schema digest so the LLM sees them up front.
_SCHEMA_USAGE = {
    "workflow": (
        "Use persona_modify(action, entity, data) for one change, "
        "persona_batch([...]) for many. Call get_schema(entity='<name>') for one "
        "entity's full fields, enum values, and copy-paste examples."
    ),
    "identifying": (
        "For update/remove, include the entity's `identifier` field (shown per "
        "entity) matching an existing item."
    ),
    "ids_automatic": (
        "Never send an `id` field — stable ids are assigned automatically on save. "
        "Reference entities by their identifier (name/topic/title/etc.)."
    ),
    "nested": (
        "Entities with a `parent` also need the parent's identifier in `data`, "
        "e.g. project_highlight needs {project_name, highlight}."
    ),
}


def _digest_entry(entity: str, spec: dict) -> dict:
    """Lean per-entity digest line: identifier, required, actions (+ parent/purpose)."""
    line = {"entity": entity, "identifier": spec.get("identifier")}
    if spec.get("parent"):
        line["parent"] = spec["parent"]
    line["required"] = spec.get("required", [])
    line["actions"] = spec.get("actions", [])
    if spec.get("description"):
        line["purpose"] = spec["description"]
    return line


def _digest(files: list[str]) -> dict:
    """Build the lean digest for the given file names."""
    return {
        # copy so a caller mutating the result can't corrupt the module constant
        "usage": dict(_SCHEMA_USAGE),
        "files": {
            f: [_digest_entry(name, spec) for name, spec in ENTITY_SCHEMA[f].items()]
            for f in files
        },
    }


def _sample_value(field: str, valid_values: dict) -> str:
    """A minimal but valid sample value for an example field."""
    if field in valid_values:
        return valid_values[field][0]
    return f"<{field}>"


def _add_sample_optional(data: dict, spec: dict) -> None:
    """Add one sample optional field (preferring one with enum values) to `data`."""
    valid_values = spec.get("valid_values", {})
    optional = spec.get("optional", [])
    chosen = next((o for o in optional if o in valid_values), None)
    if chosen is None and optional:
        chosen = optional[0]
    if chosen and chosen not in data:
        data[chosen] = _sample_value(chosen, valid_values)


def _example_data(spec: dict, mode: str) -> dict:
    """Build a data payload for an example.

    add    -> all required fields + one sample optional (a complete, valid payload).
    update -> parent + identifier (to locate) + one sample optional (to change).
    remove -> parent + identifier only (all that matching needs).
    """
    valid_values = spec.get("valid_values", {})
    data = {}
    if mode == "add":
        for field in spec.get("required", []):
            data[field] = _sample_value(field, valid_values)
        _add_sample_optional(data, spec)
        return data
    # update / remove: locate by parent + identifier
    if spec.get("parent"):
        data[spec["parent"]] = _sample_value(spec["parent"], valid_values)
    identifier = spec.get("identifier")
    if identifier:
        data[identifier] = _sample_value(identifier, valid_values)
    if mode == "update":
        _add_sample_optional(data, spec)
    return data


def _build_examples(entity: str, spec: dict) -> dict:
    """Copy-paste persona_modify examples, one per supported action."""
    actions = spec.get("actions", [])
    examples = {}
    for action in ("add", "update", "remove"):
        if action not in actions:
            continue
        data = _example_data(spec, action)
        if not data:
            # Never emit a malformed empty-data example. Fall back to the first
            # required field (not reachable today, but guards future entities).
            required = spec.get("required", [])
            if required:
                data = {required[0]: _sample_value(required[0], spec.get("valid_values", {}))}
            else:
                continue
        examples[action] = {"action": action, "entity": entity, "data": data}
    return examples


def get_entity_schema(entity: str = None, file: str = None) -> dict:
    """Get schema for entity types.

    - entity="X": full detail for one entity, with identifier and worked examples.
    - file="X": lean digest scoped to one file (usage block + its entities).
    - no args: lean digest of all files (usage block + per-file entity lines).
    """
    enabled = settings_store.enabled_sections()

    if entity:
        entity_lower = entity.lower()
        for file_name, entities in ENTITY_SCHEMA.items():
            if entity_lower in entities:
                if file_name not in enabled:
                    return {"error": f"Section '{file_name}' is disabled; enable it in settings."}
                spec = entities[entity_lower]
                detail = {"entity": entity_lower, "file": file_name,
                          "identifier": spec.get("identifier")}
                if spec.get("parent"):
                    detail["parent"] = spec["parent"]
                detail["actions"] = spec.get("actions", [])
                detail["required"] = spec.get("required", [])
                detail["optional"] = spec.get("optional", [])
                if spec.get("valid_values"):
                    detail["valid_values"] = spec["valid_values"]
                if spec.get("description"):
                    detail["purpose"] = spec["description"]
                detail["examples"] = _build_examples(entity_lower, spec)
                return detail
        valid = sorted(e for ents in ENTITY_SCHEMA.values() for e in ents)
        return {"error": f"Unknown entity: {entity}. Use get_schema() to see valid entities.",
                "valid_entities": valid}

    if file:
        file_lower = file.lower()
        if file_lower in ENTITY_SCHEMA and file_lower not in enabled:
            return {"error": f"Section '{file_lower}' is disabled."}
        if file_lower in ENTITY_SCHEMA:
            return _digest([file_lower])
        return {"error": f"Unknown file: {file}. Valid files: {', '.join(ENTITY_SCHEMA.keys())}",
                "valid_files": list(ENTITY_SCHEMA.keys())}

    return _digest([f for f in ENTITY_SCHEMA if f in enabled])


# =============================================================================
# SMART CONTEXT CAPTURE - Lean detection, LLM decides
# =============================================================================

# Trigger phrases that indicate persona-worthy content
CAPTURE_TRIGGERS = {
    "state_change": [
        "just finished", "finally finished", "completed", "done with", "wrapped up",
        "started", "began", "just started", "kicked off",
        "stopped", "quit", "dropped", "gave up on", "no longer doing",
        "switched to", "moved to", "transitioned to",
    ],
    "insight": [
        "i learned", "learned that", "i've learned", "key learning", "key takeaway",
        "i realized", "realized that", "i discovered", "helped me understand",
        "helped me realize", "now i understand", "aha moment", "breakthrough",
        "changed my perspective", "looking back", "in retrospect",
    ],
    "learning": [
        "learning", "studying", "getting into", "diving into", "exploring",
        "picked up", "been learning", "currently learning", "teaching myself",
        "getting better at", "improving at", "practicing",
    ],
    "skill_level": [
        "comfortable with", "good at", "fluent in", "expert in", "proficient in",
        "beginner at", "new to", "just starting", "intermediate at", "advanced in",
    ],
    "identity": [
        "i'm a", "i am a", "i consider myself", "i've become", "not a morning person",
        "night owl", "early bird", "introvert", "extrovert",
    ],
    "preference": [
        "i prefer", "i like", "i love", "i enjoy", "i hate", "i don't like",
        "can't stand", "not a fan of", "annoys me", "drives me crazy",
        "my go-to", "favorite", "favourite",
    ],
    "goal": [
        "want to", "planning to", "goal is", "hoping to", "aiming to",
        "dream of", "aspire to", "working towards",
    ],
    "interest": [
        "interested in", "curious about", "fascinated by", "passionate about",
        "obsessed with", "really into",
    ],
    "achievement": [
        "built", "created", "made", "developed", "launched", "shipped", "deployed",
        "achieved", "accomplished", "got accepted", "hired", "promoted", "won",
    ],
    "relationship": [
        "my friend", "my colleague", "my mentor", "my manager", "working with",
        "met someone", "my dog", "my cat", "my partner",
    ],
    "wellness": [
        "go to bed at", "wake up at", "sleep at", "most productive", "energy peaks",
    ],
}

# Phrases that indicate NON-capture-worthy content
IGNORE_PATTERNS = [
    "how do i", "how can i", "what is", "what are", "can you", "could you",
    "tell me about", "explain", "help me with", "show me",
    "i'm tired", "i'm hungry", "i'm bored", "feeling sick",
    "what if", "if i were", "hypothetically", "theoretically",
    "thanks", "thank you", "bye", "goodbye", "okay", "ok",
]

# Common skill/technology terms for entity detection
KNOWN_SKILLS = [
    # Programming Languages
    "python", "javascript", "typescript", "rust", "go", "golang", "java",
    "c++", "cpp", "c#", "csharp", "swift", "kotlin", "ruby", "php",
    # Frontend Frameworks
    "react", "reactjs", "vue", "vuejs", "svelte", "angular", "solid", "htmx",
    # Meta Frameworks
    "nextjs", "next.js", "nuxt", "nuxtjs", "sveltekit", "remix", "astro",
    # Backend Frameworks
    "django", "flask", "fastapi", "express", "nestjs", "rails", "spring",
    "laravel", "phoenix", "gin",
    # Mobile
    "react native", "flutter", "swiftui",
    # DevOps & Cloud
    "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "vercel", "netlify",
    "terraform", "github actions",
    # Tools
    "git", "github", "figma", "notion", "obsidian", "vscode",
    # Databases
    "sql", "mysql", "postgres", "postgresql", "mongodb", "redis", "supabase",
    "prisma", "drizzle",
    # APIs & Data
    "graphql", "rest", "trpc",
    # AI/ML
    "ai", "machine learning", "ml", "llm", "gpt", "claude", "langchain", "mcp",
    # CSS
    "tailwind", "tailwindcss", "css", "sass",
    # Build Tools
    "webpack", "vite", "bun", "deno",
]

# Soft skills and concepts for insight tagging
KNOWN_CONCEPTS = [
    "leadership", "delegation", "accountability", "team management",
    "project management", "event planning", "communication", "presentation",
    "time management", "goal setting", "problem solving", "decision making",
    "agile", "systems thinking", "design thinking",
]


def analyze_message_for_capture(message: str, context: str = "") -> dict:
    """
    Analyze user message for persona-worthy information.
    Returns structured signals for LLM to make final decision.
    
    The LLM should use these confidence guidelines:
    - >= 0.8: High confidence, can auto-apply and mention casually
    - 0.5-0.8: Medium confidence, ask user for confirmation
    - < 0.5: Low confidence, probably ignore
    
    Evidence that increases confidence:
    - Self-referential ("I", "my") statements
    - Present tense declarations
    - Explicit state changes ("finished", "started", "quit")
    - Duration indicators ("for months", "regularly")
    - Concrete outputs ("built", "deployed", "shipped")
    
    Evidence that decreases confidence:
    - Questions or requests for help
    - Hypotheticals ("what if", "maybe")
    - Venting/emotional outbursts
    - Casual chat markers ("lol", "idk")
    """
    message_lower = message.lower()
    
    result = {
        "should_capture": False,
        "confidence": 0.0,
        "suggestions": [],
        "detected_triggers": [],
        "detected_entities": [],
        "statement_signals": {},
        "ignore_reason": None
    }
    
    # Check ignore patterns first
    for pattern in IGNORE_PATTERNS:
        if pattern in message_lower:
            result["ignore_reason"] = f"Matched ignore pattern: '{pattern}'"
            result["confidence"] = 0.1
            return result
    
    # Detect triggers by category
    trigger_categories = []
    for category, phrases in CAPTURE_TRIGGERS.items():
        for phrase in phrases:
            if phrase in message_lower:
                trigger_categories.append(category)
                result["detected_triggers"].append(f"{category}: {phrase}")
                break
    
    # Detect skills/technologies mentioned
    detected_skills = []
    for skill in KNOWN_SKILLS:
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, message_lower, re.IGNORECASE):
            detected_skills.append(skill.title() if len(skill) > 3 else skill.upper())
            result["detected_entities"].append(f"skill: {skill}")
    
    # Detect concepts mentioned
    detected_concepts = []
    for concept in KNOWN_CONCEPTS:
        pattern = r'\b' + re.escape(concept) + r'\b'
        if re.search(pattern, message_lower, re.IGNORECASE):
            detected_concepts.append(concept.title())
            result["detected_entities"].append(f"concept: {concept}")
    
    # Statement quality signals for LLM
    self_markers = ["i ", "i'm", "i've", "i'd", "my ", "me ", "myself"]
    has_self_reference = any(m in message_lower for m in self_markers)
    
    present_markers = ["currently", "right now", "these days", "i'm currently", "i am now"]
    is_present_tense = any(m in message_lower for m in present_markers)
    
    duration_markers = ["months", "weeks", "years", "regularly", "for a while", "been"]
    has_duration = any(m in message_lower for m in duration_markers)
    
    output_verbs = ["built", "created", "deployed", "shipped", "launched", "made"]
    has_output = any(v in message_lower for v in output_verbs)
    
    hypothetical_markers = ["what if", "if i were", "hypothetically", "maybe i", "might"]
    is_hypothetical = any(m in message_lower for m in hypothetical_markers)
    
    result["statement_signals"] = {
        "self_referential": has_self_reference,
        "present_tense": is_present_tense,
        "has_duration": has_duration,
        "has_concrete_output": has_output,
        "is_hypothetical": is_hypothetical,
    }
    
    # Load persona for overlap detection
    persona = get_all_persona_data()
    existing_domains = [d.get("name", "").lower() for d in persona.get("knowledge", {}).get("domains", [])]
    existing_hobbies = [h.get("name", "").lower() for h in persona.get("lifestyle", {}).get("hobbies", [])]
    
    suggestions = []
    
    # Generate suggestions based on triggers + entities
    # LLM can refine these based on full context
    
    if "learning" in trigger_categories and detected_skills:
        for skill in detected_skills:
            if skill.lower() not in existing_domains:
                level = determine_skill_level(skill, message, result["detected_triggers"])
                suggestions.append({
                    "action": "add", "entity": "domain",
                    "data": {"name": skill, "level": level},
                    "reason": f"Learning activity detected: {skill}",
                    "confidence": 0.75 if has_self_reference else 0.55
                })
    
    if "insight" in trigger_categories:
        # Extract topic from message
        topic = None
        for phrase in ["i learned", "learned that", "i realized", "key learning", "key insight"]:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                words = [w for w in after.split()[:8] if w not in ["that", "the", "a", "an"]]
                topic = " ".join(words[:5]).rstrip(".,!?").capitalize()
                break
        
        if not topic and (detected_concepts or detected_skills):
            topic = f"{(detected_concepts or detected_skills)[0]} Insight"
        
        if topic:
            suggestions.append({
                "action": "add", "entity": "learning_entry",
                "data": {
                    "topic": topic or "Insight",
                    "details": message,
                    "source": "conversation",
                    "tags": detected_concepts + detected_skills
                },
                "reason": "Conceptual insight detected",
                "confidence": 0.82 if has_self_reference else 0.6
            })
    
    if "achievement" in trigger_categories:
        for skill in detected_skills:
            if skill.lower() not in existing_domains:
                suggestions.append({
                    "action": "add", "entity": "domain",
                    "data": {"name": skill, "level": "intermediate"},
                    "reason": f"Built something with: {skill}",
                    "confidence": 0.78 if has_output else 0.6
                })
    
    if "preference" in trigger_categories:
        # Detect dislikes
        dislike_phrases = ["i hate", "can't stand", "not a fan of", "annoys me", "drives me crazy"]
        for phrase in dislike_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                item = " ".join(after.split()[:5]).rstrip(".,!?")
                if item and len(item) > 2:
                    suggestions.append({
                        "action": "add", "entity": "dislike",
                        "data": {"dislike": item},
                        "reason": f"Negative preference: '{item}'",
                        "confidence": 0.72
                    })
                break
    
    if "identity" in trigger_categories:
        # Detect personality traits
        trait_patterns = [
            ("not a morning person", "not a morning person"),
            ("night owl", "night owl"),
            ("early bird", "early bird"),
            ("introvert", "introverted"),
            ("extrovert", "extroverted"),
        ]
        for pattern, trait in trait_patterns:
            if pattern in message_lower:
                suggestions.append({
                    "action": "add", "entity": "personality_trait",
                    "data": {"trait": trait},
                    "reason": f"Self-identified trait: {trait}",
                    "confidence": 0.80
                })
                break
    
    if "goal" in trigger_categories:
        for phrase in ["want to", "planning to", "goal is", "hoping to", "aiming to"]:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                goal = " ".join(after.split()[:7]).rstrip(".,!?")
                if goal and len(goal) > 3:
                    career_indicators = ["become", "be a", "learn", "master", "work", "build", "start"]
                    is_career = any(ind in goal for ind in career_indicators)
                    if is_career:
                        suggestions.append({
                            "action": "add", "entity": "career_aspiration",
                            "data": {"aspiration": goal},
                            "reason": f"Career/learning goal: {goal}",
                            "confidence": 0.65
                        })
                break
    
    if "interest" in trigger_categories:
        for phrase in ["passionate about", "obsessed with", "really into"]:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                item = " ".join(after.split()[:4]).rstrip(".,!?")
                if item:
                    suggestions.append({
                        "action": "add", "entity": "passion",
                        "data": {"passion": item},
                        "reason": f"Strong interest: {item}",
                        "confidence": 0.70
                    })
                break
        
        for phrase in ["curious about", "interested in", "fascinated by"]:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                item = " ".join(after.split()[:5]).rstrip(".,!?")
                if item:
                    suggestions.append({
                        "action": "add", "entity": "curiosity",
                        "data": {"curiosity": item},
                        "reason": f"Curiosity: {item}",
                        "confidence": 0.65
                    })
                break
    
    if "state_change" in trigger_categories:
        # Detect explicit state changes (high confidence)
        state_changes = detect_explicit_state_changes(message_lower)
        if state_changes:
            result["state_changes"] = state_changes
            # Boost confidence for explicit state changes
            for s in suggestions:
                s["confidence"] = min(s["confidence"] + 0.1, 0.95)
    
    # Apply confidence modifiers
    if is_hypothetical:
        for s in suggestions:
            s["confidence"] *= 0.5
            s["reason"] += " (hypothetical - verify)"
    
    if not has_self_reference:
        for s in suggestions:
            s["confidence"] *= 0.85
    
    # Cross-reference with existing persona
    for s in suggestions:
        s = cross_reference_persona(s, persona)
    
    # Deduplicate
    suggestions = deduplicate_suggestions(suggestions)
    
    if suggestions:
        result["suggestions"] = suggestions
        result["confidence"] = max(s["confidence"] for s in suggestions)
        result["should_capture"] = result["confidence"] >= 0.5
    elif trigger_categories:
        result["confidence"] = 0.3
        result["ignore_reason"] = "Triggers detected but no actionable entities"
    else:
        result["confidence"] = 0.1
        result["ignore_reason"] = "No persona-relevant triggers detected"
    
    return result


# =============================================================================
# FASTMCP SERVER INITIALIZATION
# =============================================================================

mcp = FastMCP(
    "mygist",
    instructions="""MyGist is your portable personal context for AI.
    
Available tools:
- get_context: Retrieve scoped persona context (minimal/professional/personal/learning/full)
- get_raw: Get raw JSON file data for detailed inspection
- get_schema: Discover valid entity types and their fields
- persona_modify: Add, update, or remove persona data
- persona_batch: Perform multiple modifications at once
- suggest_persona_update: Analyze messages for potential persona updates

Always call get_context at the start of conversations to personalize responses."""
)


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

@mcp.tool()
def get_context(
    scope: Union[str, List[str]] = "minimal",
    topic: Optional[str] = None,
    include_inactive: bool = False,
    days: Optional[int] = None,
    limit: Optional[int] = None
) -> str:
    """
    Retrieve scoped persona context. Call this FIRST at conversation start.

    WHEN TO USE:
        - Start of any conversation (always)
        - When you need user preferences to tailor responses
        - To FIND specific entries (a project, a note, a person), do NOT pull a large scope — use search_context, then get_entity.

    SCOPES (global):
        - minimal: Quick questions, greetings, code help. Returns: name, bio, top_of_mind, preferences
        - professional: Career, projects, technical. Returns: profile, skills, projects, code_style
        - personal: Life advice, hobbies, wellness. Returns: hobbies, personality, connections
        - learning: Skill development, roadmaps. Returns: skills, learning_log (last 60 days)
        - full: complete dump — prefer targeted scopes plus search_context.

    SECTION SCOPES: profile | knowledge | preferences | projects | lifestyle | circle | learning_log
        - A section scope returns that whole section plus your always-on
          preferences (tone, detail_level, dislikes, learning_style).

    MULTIPLE: pass a list to union scopes, e.g. ["lifestyle", "circle"].

    ARGS:
        scope: a global scope name, a section key, or a list of them
        topic: Filter to items matching this topic (e.g., "react", "cooking")
        include_inactive: Include inactive/paused items
        days: Limit learning_log to last N days
        limit: Max learning_log entries to return

    RETURNS:
        Filtered persona data based on scope + user preferences (tone, detail_level, dislikes)
    """
    result = get_scoped_context(scope, topic, include_inactive, days, limit)
    # Compact serialization keeps the returned string consistent with the
    # token_estimate computed in get_scoped_context, and shrinks the payload.
    return json.dumps(result, ensure_ascii=False)


@mcp.tool()
def get_raw(
    file: str = "all"
) -> str:
    """
    Raw dump of persona file(s) — export/debug use. For finding specific
    content, prefer search_context (ranked snippets) + get_entity (full detail).

    WHEN TO USE:
        - Before modifying data (to see current state)
        - When get_context doesn't have enough detail

    FILES:
        - all: Complete persona (all files)
        - profile: name, bio, contact, work_experience[], education[]
        - lifestyle: hobbies[], passions[], curiosities[], values[]
        - knowledge: domains[] (skills), mental_tabs[]
        - preferences: code_style, communication, learning_style, dislikes[]
        - projects: projects[], current_learning[], top_of_mind[]
        - circle: connections[]
        - learning_log: entries[]

    ARGS:
        file: File to retrieve

    RETURNS: 
        Raw JSON for the specified file(s)
    """
    enabled = settings_store.enabled_sections()
    if file == "all":
        data = get_all_persona_data()
        return json.dumps({k: v for k, v in data.items() if k in enabled}, indent=2)
    elif file in FILE_MAP and file in enabled:
        return json.dumps(load_json(FILE_MAP[file]), indent=2)
    elif file in FILE_MAP:  # exists but disabled
        return f"❌ Section '{file}' is disabled. Enable it in settings."
    else:
        return f"❌ Unknown file: {file}. Valid: all, {', '.join(persona_store.VALID_FILES)}"


@mcp.tool()
def search_context(query: str, sections: Union[str, List[str], None] = None,
                    limit: int = 10) -> str:
    """Search the persona for relevant entries by meaning and keywords.

    PREFERRED way to find specific persona content — returns small ranked
    snippets instead of whole sections. Follow up with get_entity(entity_id)
    for full detail on a hit. Modes: "hybrid" (FTS + embeddings) or "fts"
    (no embedding provider configured).

    Args:
        query: What to look for (natural language or keywords).
        sections: Optional section name or list to restrict the search
            (e.g. "projects" or ["knowledge", "learning_log"]).
        limit: Max results, 1-25 (default 10).
    """
    if not query or not query.strip():
        return "Error: query must be a non-empty string"
    if isinstance(sections, str):
        sections = [sections]
    valid = set(SECTION_REGISTRY)
    if sections:
        unknown = [s for s in sections if s not in valid]
        if unknown:
            return (f"Unknown section(s): {', '.join(unknown)}. "
                    f"Valid: {', '.join(sorted(valid))}")
    disabled = settings_store.get_disabled_sections()
    if sections and all(s in disabled for s in sections):
        # Every requested section is disabled -- an explicit error (same
        # wording as get_entity), not a silently-empty result set.
        if len(sections) == 1:
            return f"❌ Section '{sections[0]}' is disabled. Enable it in settings."
        return (f"❌ Sections {', '.join(repr(s) for s in sections)} are "
                "disabled. Enable them in settings.")
    limit = max(1, min(int(limit), 25))
    user_id = db.current_user_id.get()
    out = search_index.search(user_id, query.strip(), sections, limit,
                               exclude_sections=list(disabled))
    out["query"] = query.strip()
    return json.dumps(out, indent=2)


@mcp.tool()
def get_entity(entity_id: str) -> str:
    """Fetch one persona entity in full by its id (as returned by
    search_context results or embedded in get_context output).

    Args:
        entity_id: Prefixed id, e.g. "project_ab12cd34", "learn_20260721_x1y2z3".
    """
    loc = search_index.entity_location(entity_id)
    if loc is None:
        prefixes = sorted({p for p, _ in search_index._PREFIXES})
        return ("Unknown entity id prefix. Valid prefixes: "
                + ", ".join(prefixes))
    file_type, list_key = loc
    disabled = settings_store.get_disabled_sections()
    if file_type in disabled:
        return f"❌ Section '{file_type}' is disabled. Enable it in settings."
    data = load_json(file_type)
    for entity in data.get(list_key) or []:
        if isinstance(entity, dict) and entity.get("id") == entity_id:
            return json.dumps({"section": file_type, "entity_id": entity_id,
                               "entity": entity}, indent=2)
    return f"❌ Entity {entity_id} not found in {file_type}.{list_key}"


@mcp.tool()
def get_schema(
    file: Optional[str] = None,
    entity: Optional[str] = None
) -> str:
    """
    Discover valid entity types for persona_modify. Digest first, then drill down.

    BEHAVIOR:
        - No args → lean DIGEST: a `usage` block (workflow + how to identify items
          + ids are automatic + nested rules) plus `files`, each listing its
          entities with their `identifier`, `required` fields and `actions`.
        - entity="X" → FULL detail for one entity: identifier, parent (if nested),
          actions, required, optional, valid_values, plus copy-paste `examples`
          (add / update / remove as supported).
        - file="X" → the same lean digest scoped to that one file.

    The `identifier` is the field in `data` that matches an existing item on
    update/remove. Nested entities also expose a `parent` field that must be in
    `data`. Never send an `id` — ids are assigned automatically.

    ARGS:
        file: Scope digest to one file (profile, lifestyle, knowledge, etc.)
        entity: Full detail + examples for one entity (e.g., 'hobby', 'project')

    RETURNS:
        {usage, files} digest, or {entity, file, identifier, ..., examples} detail
    """
    result = get_entity_schema(entity=entity, file=file)
    return json.dumps(result, indent=2)


# =============================================================================
# ADVISORY DUPLICATE DETECTION — best-effort "resembles existing" nudge on adds
# =============================================================================

# Cosine distance cutoff for the vector leg of the duplicate-advisory search.
# Deliberately tighter than TOPIC_VECTOR_DISTANCE_CUTOFF (topic filtering,
# 0.5): that cutoff only needs "related enough to surface"; this one needs
# "close enough to plausibly be the same thing," so a near-identical text
# match is required before the write-time nudge fires.
DUPLICATE_DISTANCE_CUTOFF = 0.4

# Top-level id-list entities eligible for the advisory duplicate check on
# "add": entity name -> (file_type, list_key). Built by cross-referencing
# ENTITY_SCHEMA's add-capable entities against each execute_modify branch and
# sections.SECTION_REGISTRY's id_lists -- only lists whose items get a stable
# `id` (via persona_store._assign_ids) qualify, since the advisory result
# must resolve to a real entity_id. Sub-entities that write into plain
# nested lists with no id (email, link, work_highlight, *_reference,
# coursework, coursework_topic, education_highlight, hobby_reference,
# hobby_specific, project_tag, project_reference, project_highlight,
# mental_tab_reference, domain_reference) are excluded, as are
# non-id-list top-level entities: passion/curiosity/personality_trait/value/
# energy_peak/dislike/preference (plain-value lists, no id_lists entry),
# career_aspiration (writes into `career_aspirations`, a plain-string list
# distinct from profile's registered `goals_and_careers` id_list -- no
# ENTITY_SCHEMA entity currently targets `goals_and_careers`), the
# update-only singletons basic_info/communication_default/sleep, and
# `knowledge` (writes into a caller-chosen category via `data["category"]`,
# not one fixed list_key -- `domain` already covers the one fixed id-list,
# `domains`).
ADVISORY_ENTITIES: dict[str, tuple[str, str]] = {
    "work_experience": ("profile", "work_experience"),
    "education": ("profile", "education"),
    "language": ("profile", "languages_spoken"),
    "domain": ("knowledge", "domains"),
    "mental_tab": ("knowledge", "mental_tabs"),
    "project": ("projects", "projects"),
    "current_learning": ("projects", "current_learning"),
    "top_of_mind": ("projects", "top_of_mind"),
    "hobby": ("lifestyle", "hobbies"),
    "connection": ("circle", "connections"),
    "learning_entry": ("learning_log", "entries"),
}


def _find_strong_match(file_type: str, entity_data: dict) -> Optional[dict]:
    """Advisory-only: does `entity_data` resemble an existing same-section
    entity closely enough to warn about? Returns
    {"entity_id", "title", "distance"} for the top qualifying hit, else None.
    Never raises -- this runs before the real write and must not block it.

    Criteria (checked per hit, so one pass covers both search modes):
      - hybrid (embeddings configured): hit distance is not None and
        <= DUPLICATE_DISTANCE_CUTOFF.
      - FTS-only (no embeddings, hit distance is None): exact
        case-insensitive title match against the flattened title (FTS
        relevance/snippet overlap alone is too noisy to imply "duplicate").
    """
    try:
        flattened_title, flattened_text = search_index.flatten_entity(entity_data)
        if not flattened_text:
            return None
        user_id = db.current_user_id.get()
        # `flattened_text` folds title + every text/nested field into one blob
        # (fine for the vector leg -- length doesn't matter there), but
        # websearch_to_tsquery ANDs all of its words together, so a hit whose
        # title matches exactly but whose other fields don't share a single
        # word would never satisfy the FTS leg's `tsv @@ q` on flattened_text
        # alone. OR-ing the title in front keeps that door open (title alone
        # can satisfy the FTS predicate) without weakening the vector leg,
        # which reads the whole query string regardless of the "OR" token.
        query = f"{flattened_title} OR {flattened_text}" if flattened_title else flattened_text
        hits = search_index.search(user_id, query, [file_type], limit=3)
        for hit in hits["results"]:
            if hit["distance"] is not None and hit["distance"] <= DUPLICATE_DISTANCE_CUTOFF:
                return {"entity_id": hit["entity_id"], "title": hit["title"],
                        "distance": hit["distance"]}
            if flattened_title and hit["title"].lower() == flattened_title.lower():
                return {"entity_id": hit["entity_id"], "title": hit["title"],
                        "distance": hit["distance"]}
        return None
    except Exception:
        logger.warning("duplicate-advisory check failed for file_type=%s",
                       file_type, exc_info=True)
        return None


def _advisory_note(match: dict) -> str:
    """The verbatim advisory line appended to a successful add's message
    (spec wording -- leading space to separate it from the success message)."""
    return (f' Note: resembles existing {match["entity_id"]} '
            f'"{match["title"]}" — if this is the same item, '
            f'use action="update" instead.')


@mcp.tool()
def persona_modify(
    action: Literal["add", "update", "remove"],
    entity: str,
    data: dict
) -> str:
    """Add, update, or remove a single item from persona data.
    If unsure, use get_schema to discover valid entity types, required fields, and enum values.

    Args:
        action: "add" | "update" | "remove"
        entity: Entity type (use get_schema to discover valid types)
        data: Object with identifier + fields. Always include: name, title, topic, or address

    DATA REQUIREMENTS:
        - Always include identifier: name, title, topic, or address (depends on entity)
        - For update/remove: identifier matches existing item
        - For add: identifier + any optional fields

    EXAMPLES:
        - ADD hobby: {action: "add", entity: "hobby", data: {name: "Photography", skill_level: "beginner"}}
        - UPDATE project: {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}}
        - REMOVE domain: {action: "remove", entity: "domain", data: {name: "PHP"}}
        - ADD learning_entry: {action: "add", entity: "learning_entry", data: {topic: "React Hooks", details: "...", source: "Claude"}}

    NESTED ITEMS (include parent identifier):
        - work_highlight: {company: "Acme", highlight: "Led migration"}
        - project_reference: {project_name: "MyApp", ref_name: "Docs", url: "https://..."}

    RETURN:
        Success/error message
    """
    match = None
    if action == "add" and entity.lower() in ADVISORY_ENTITIES:
        file_type, _list_key = ADVISORY_ENTITIES[entity.lower()]
        match = _find_strong_match(file_type, normalize_data(data, entity.lower()))
    result = execute_modify(action, entity, data)
    if match and not result.startswith("❌"):
        result += _advisory_note(match)
    return result


@mcp.tool()
def persona_batch(operations: list) -> str:
    """Perform multiple persona modifications in one call.
    If unsure, use get_schema to discover valid entity types and fields.
    
    WHEN TO USE:
        - Adding multiple items at once (e.g., several highlights)
        - Updating related items together

    ARGS:
        operations (required): Array of {action, entity, data} objects

    EXAMPLES:
        {operations: [
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Led API"}},
            {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}}
        ]}

        - Multiple highlights:
        {operations: [
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Led API"}},
            {action: "add", entity: "work_highlight", data: {company: "Acme", highlight: "Built dashboard"}}
        ]}
        - Mixed operations:
        {operations: [
            {action: "update", entity: "project", data: {name: "MyApp", status: "completed"}},
            {action: "add", entity: "project_highlight", data: {project_name: "MyApp", highlight: "Launched v1"}}
        ]}

    RETURN:
        Numbered list of results for each operation
    """
    if not operations:
        return "❌ No operations provided"
    
    results = []
    for i, op in enumerate(operations):
        action = op.get("action", "")
        entity = op.get("entity", "")
        data = op.get("data", {})
        match = None
        if action == "add" and entity.lower() in ADVISORY_ENTITIES:
            file_type, _list_key = ADVISORY_ENTITIES[entity.lower()]
            match = _find_strong_match(file_type, normalize_data(data, entity.lower()))
        result = execute_modify(action, entity, data)
        if match and not result.startswith("❌"):
            result += _advisory_note(match)
        results.append(f"{i+1}. {result}")

    return "\n".join(results)


@mcp.tool()
def suggest_persona_update(message: str, context: str = "") -> str:
    """Analyze user message for potential persona updates, grounding each
    `add` suggestion against existing data before returning it. Call
    proactively during conversation.

    WHEN TO USE:
        - User mentions achievements, completions, new skills
        - User expresses preferences, dislikes, opinions
        - User shares life updates (job, hobby, learning progress)
        - User reflects on insights or lessons learned

    ARGS:
        message: User message to analyze
        context: Optional conversation context for ambiguity resolution

    ANALYSIS: message text is scored for capture-worthiness (self-reference,
    tense, concrete outputs, hypotheticals, ...) and turned into candidate
    `add`/entity/data suggestions -- see CONFIDENCE BOOSTERS/REDUCERS below.

    DEDUPE: each candidate `add` suggestion for a dedupe-eligible entity
    (the same top-level id-list entities persona_modify checks -- project,
    hobby, domain, connection, work_experience, education, etc.) is then
    checked against existing persona data via the same search-backed
    duplicate detector persona_modify's advisory uses. A strong match:
        - attaches `existing_entity: {entity_id, title}` to the suggestion, and
        - rewrites `action` from "add" to "update" -- but only when the
          matched entity's identifier value can actually be derived from the
          hit (a name/title-like identifier field), so every "update"
          suggestion returned is executable via persona_modify as-is. When it
          can't be derived, the suggestion stays "add" with `existing_entity`
          attached as a hint only.
    A failed dedupe check (search error, etc.) never blocks the response --
    suggestions are returned unmodified in that case. The response always
    carries `dedupe_checked: true` once this pass has run.

    RESPONSE INCLUDES:
        - confidence: 0.0-1.0 score based on statement quality
        - suggestions: Ready-to-apply persona_modify operations, dedupe-checked
          (may include `existing_entity` and an `action` rewritten to "update")
        - statement_signals: Evidence markers (self_referential, present_tense, etc.)
        - action_required: "auto_apply" | "ask_user" | "ignore"
        - dedupe_checked: true, confirming the dedupe pass ran

    DECISION GUIDANCE:
        - >= 0.8: High confidence. Apply via persona_modify, mention: "✓ Updated your persona..."
        - 0.5-0.8: Medium confidence. Ask: "Should I add X to your persona?"
        - < 0.5: Low confidence. Respond normally, no persona mention.

    CONFIDENCE BOOSTERS (use your judgment and conversation context to adjust):
        - Self-referential ("I", "my") statements: +trust
        - Present tense declarations: +trust
        - Explicit state changes ("finished", "started"): +trust
        - Concrete outputs ("built", "deployed"): +trust
        - Duration indicators ("for months"): +trust

    CONFIDENCE REDUCERS (use your judgment and conversation context to adjust):
        - Hypotheticals ("what if", "maybe"): -trust
        - Questions/requests for help: -trust
        - Casual venting: -trust

    RETURNS:
        {should_capture, confidence, suggestions: [{action, entity, data,
         existing_entity?}], dedupe_checked, instruction}
    """
    if not message:
        return json.dumps({
            "error": "No message provided", "should_capture": False,
            "confidence": 0.0, "suggestions": []
        }, indent=2)

    analysis = analyze_message_for_capture(message, context)

    for suggestion in analysis["suggestions"]:
        entity = suggestion.get("entity", "").lower()
        if suggestion.get("action") != "add" or entity not in ADVISORY_ENTITIES:
            continue
        file_type, _list_key = ADVISORY_ENTITIES[entity]
        data = suggestion.get("data", {})
        match = _find_strong_match(file_type, normalize_data(data, entity))
        if not match:
            continue
        suggestion["existing_entity"] = {
            "entity_id": match["entity_id"], "title": match["title"]
        }
        file_name = _section_for_entity(entity)
        identifier_field = ENTITY_SCHEMA.get(file_name, {}).get(entity, {}).get("identifier")
        # Only rewrite to "update" when the identifier's value can actually
        # be recovered from the hit -- i.e. the identifier is one of the
        # name/title-like fields flatten_entity draws its title from. Other
        # identifiers (e.g. work_experience's "company", top_of_mind's
        # "item") aren't reflected in hit["title"], so deriving one would
        # produce an un-executable update; keep those as "add".
        if identifier_field and identifier_field in search_index.TITLE_FIELDS:
            suggestion["data"] = dict(data, **{identifier_field: match["title"]})
            suggestion["action"] = "update"

    # Determine action
    if analysis["confidence"] >= 0.8:
        action = "auto_apply"
        instruction = "HIGH confidence. Apply using persona_modify, then mention: '✓ Updated your persona with...'"
    elif analysis["confidence"] >= 0.5:
        action = "ask_user"
        instruction = "MEDIUM confidence. Ask: 'Want me to add X to your persona?'"
    else:
        action = "ignore"
        instruction = "LOW confidence. Respond normally without mentioning persona."

    response = {
        "should_capture": analysis["should_capture"],
        "confidence": analysis["confidence"],
        "confidence_level": "high" if analysis["confidence"] >= 0.8 else "medium" if analysis["confidence"] >= 0.5 else "low",
        "suggestions": analysis["suggestions"],
        "detected_triggers": analysis["detected_triggers"],
        "detected_entities": analysis["detected_entities"],
        "statement_signals": analysis.get("statement_signals", {}),
        "state_changes": analysis.get("state_changes", []),
        "action_required": action,
        "ignore_reason": analysis.get("ignore_reason"),
        "dedupe_checked": True,
        "instruction": instruction
    }

    return json.dumps(response, indent=2)


# # =============================================================================
# # HEALTH CHECK ENDPOINTS & APP SETUP
# # =============================================================================

# async def health_check(request):
#     """Health check endpoint for container orchestration."""
#     return JSONResponse({
#         "status": "ok",
#         "service": "mygist",
#         "data_dir": str(DATA_DIR),
#         "data_dir_exists": DATA_DIR.exists()
#     })

# async def root_handler(request):
#     """Root endpoint with service info."""
#     return JSONResponse({
#         "service": "MyGist MCP Server",
#         "version": "2.0.0",
#         "description": "Your portable personal context for AI",
#         "transport": "FastMCP with SSE/Streamable HTTP",
#         "endpoints": {
#             "health": "/health",
#             "mcp": "/mcp"
#         }
#     })


# async def export_data(request):
#     """Export all MyGist data as a downloadable zip file."""
#     if not DATA_DIR.exists():
#         return JSONResponse({"error": "Data directory not found"}, status_code=404)
    
#     # Create zip in memory
#     zip_buffer = io.BytesIO()
    
#     with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
#         # Add all JSON files from DATA_DIR
#         for json_file in DATA_DIR.glob("*.json"):
#             zf.write(json_file, json_file.name)
        
#         # Add metadata
#         metadata = {
#             "exported_at": datetime.now().isoformat(),
#             "version": "2.0.0",
#             "files": [f.name for f in DATA_DIR.glob("*.json")]
#         }
#         zf.writestr("_metadata.json", json.dumps(metadata, indent=2))
    
#     zip_buffer.seek(0)
#     timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
#     filename = f"mygist_backup_{timestamp}.zip"
    
#     return Response(
#         content=zip_buffer.getvalue(),
#         media_type="application/zip",
#         headers={"Content-Disposition": f"attachment; filename={filename}"}
#     )


# async def import_data(request):
#     """Import MyGist data from an uploaded zip file."""
#     content_type = request.headers.get("content-type", "")
    
#     if "multipart/form-data" in content_type:
#         # Handle form upload
#         form = await request.form()
#         upload = form.get("file")
#         if not upload:
#             return JSONResponse({"error": "No file uploaded"}, status_code=400)
#         zip_data = await upload.read()
#     else:
#         # Handle raw body upload
#         zip_data = await request.body()
    
#     if not zip_data:
#         return JSONResponse({"error": "No data received"}, status_code=400)
    
#     # Validate it's a zip file
#     try:
#         zip_buffer = io.BytesIO(zip_data)
#         with zipfile.ZipFile(zip_buffer, 'r') as zf:
#             # Security check: only allow .json files
#             for name in zf.namelist():
#                 if not name.endswith('.json'):
#                     continue
#                 # Prevent path traversal
#                 if '..' in name or name.startswith('/'):
#                     return JSONResponse({"error": f"Invalid filename: {name}"}, status_code=400)
            
#             # Create backup of current data
#             backup_dir = DATA_DIR.parent / f"mygist_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
#             if DATA_DIR.exists():
#                 shutil.copytree(DATA_DIR, backup_dir)
#                 logger.info(f"Created backup at: {backup_dir}")
            
#             # Ensure data dir exists
#             DATA_DIR.mkdir(parents=True, exist_ok=True)
            
#             # Extract only JSON files
#             imported_files = []
#             for name in zf.namelist():
#                 if name.endswith('.json') and not name.startswith('_'):
#                     zf.extract(name, DATA_DIR)
#                     imported_files.append(name)
#                     logger.info(f"Imported: {name}")
            
#             return JSONResponse({
#                 "status": "success",
#                 "imported_files": imported_files,
#                 "backup_created": str(backup_dir) if backup_dir.exists() else None
#             })
            
#     except zipfile.BadZipFile:
#         return JSONResponse({"error": "Invalid zip file"}, status_code=400)
#     except Exception as e:
#         logger.error(f"Import failed: {e}")
#         return JSONResponse({"error": f"Import failed: {str(e)}"}, status_code=500)


# def create_app():
#     """Create the production app with auth middleware."""
#     # Get the underlying Starlette app from FastMCP
#     starlette_app = mcp.http_app()
    
#     # Add custom routes for health checks and data management
#     starlette_app.routes.insert(0, Route("/", endpoint=root_handler, methods=["GET"]))
#     starlette_app.routes.insert(1, Route("/health", endpoint=health_check, methods=["GET"]))
#     starlette_app.routes.insert(2, Route("/healthz", endpoint=health_check, methods=["GET"]))
#     starlette_app.routes.insert(3, Route("/export", endpoint=export_data, methods=["GET"]))
#     starlette_app.routes.insert(4, Route("/import", endpoint=import_data, methods=["POST"]))
    
#     # Add Bearer auth middleware
#     api_token = os.getenv("MYGIST_API_TOKEN")
#     starlette_app.add_middleware(BearerAuthMiddleware, token=api_token)
    
#     logger.info(f"MyGist MCP Server initialized")
#     logger.info(f"Data directory: {DATA_DIR}")
#     logger.info(f"Auth enabled: {bool(api_token)}")
    
#     return starlette_app


# # Create app for uvicorn
# app = create_app()


# =============================================================================
# MAIN ENTRY POINTS
# =============================================================================

if __name__ == "__main__":
    import sys
    
    # # Check if running in HTTP mode
    # if "--http" in sys.argv or os.getenv("MCP_TRANSPORT") == "http":
    #     import uvicorn
    #     port = int(os.getenv("PORT", "8000"))
    #     host = os.getenv("HOST", "0.0.0.0")
    #     uvicorn.run(app, host=host, port=port)
    # else:
    #     # Default: stdio transport for local MCP clients
    mcp.run()
