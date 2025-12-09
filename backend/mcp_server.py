#!/usr/bin/env python3
"""
MCP Server for Persona Data (v2 - Consolidated)
Streamlined tools for reading and modifying persona data.
"""

import json
import sys
import re
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, Prompt, PromptMessage, PromptArgument

# Setup logging to stderr for debugging
logging.basicConfig(
    stream=sys.stderr, 
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Data directory path
DATA_DIR = Path(__file__).parent.parent / "persona_mcp" / "data"
logger.info(f"Data directory: {DATA_DIR}")

# File mapping for different data types
FILE_MAP = {
    "profile": "profile.json",
    "lifestyle": "lifestyle.json", 
    "knowledge": "knowledge.json",
    "preferences": "preferences.json",
    "projects": "projects.json",
    "learning_log": "learning_log.json"
}

def load_json(filename: str) -> dict:
    """Load JSON data from file"""
    path = DATA_DIR / filename
    if not path.exists():
        return {"error": f"{filename} not found"}
    with open(path, "r") as f:
        return json.load(f)

def save_json(filename: str, data: dict) -> bool:
    """Save JSON data to file"""
    path = DATA_DIR / filename
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving {filename}: {str(e)}")
        return False

def get_all_persona_data() -> dict:
    """Get all persona data"""
    return {key: load_json(filename) for key, filename in FILE_MAP.items()}


# -----------------------------------------------------------------------------
# Scoped Context System - Token-efficient persona retrieval
# -----------------------------------------------------------------------------

CONTEXT_SCOPES = {
    "minimal": {
        "description": "Quick identity snapshot (~250 tokens)",
        "fields": {
            "profile": ["name", "bio", "location", "current_role"],
            "projects": ["top_of_mind"],
            "preferences": ["communication_default"]  # Just default tone/locale
        }
    },
    "professional": {
        "description": "Work-relevant context (~1000 tokens)",
        "fields": {
            "profile": ["name", "bio", "location", "current_role", "work_experience", "education", "career_aspirations"],
            "knowledge": ["domains"],
            "projects": ["projects", "current_learning", "top_of_mind"],
            "preferences": ["code_style", "work_preferences", "communication", "dislikes"]
        }
    },
    "personal": {
        "description": "Hobbies, interests, personality (~600 tokens)",
        "fields": {
            "profile": ["name", "bio", "location"],
            "lifestyle": ["hobbies", "passions", "curiosities", "personality_traits", "values", "wellness"],
            "preferences": ["communication", "dislikes"]
        }
    },
    "learning": {
        "description": "Current learning focus (~500 tokens)",
        "fields": {
            "profile": ["name"],
            "knowledge": ["domains", "mental_tabs"],
            "projects": ["current_learning", "top_of_mind"],
            "preferences": ["learning_style"],
            "learning_log": ["entries"]
        }
    },
    "full": {
        "description": "Complete persona (~2000+ tokens)",
        "fields": "all"
    }
}

def get_scoped_context(
    scope: str = "minimal",
    topic: str = None,
    include_inactive: bool = False
) -> dict:
    """
    Get persona context filtered by scope and optional topic.
    
    Args:
        scope: minimal | professional | personal | learning | full
        topic: Optional keyword to filter relevant items (e.g., "python", "cooking")
        include_inactive: Whether to include inactive hobbies, paused projects, etc.
    
    Returns:
        Scoped context with token estimate
    """
    if scope not in CONTEXT_SCOPES:
        return {"error": f"Unknown scope '{scope}'. Valid: {list(CONTEXT_SCOPES.keys())}"}
    
    scope_config = CONTEXT_SCOPES[scope]
    all_data = get_all_persona_data()
    result = {}
    
    # Full scope = return everything
    if scope_config["fields"] == "all":
        result = all_data
    else:
        # Extract only specified fields
        for file_key, fields in scope_config["fields"].items():
            data = all_data.get(file_key, {})
            if not data or "error" in data:
                continue
                
            result[file_key] = {}
            for field in fields:
                # Special case: communication_default only returns the default part
                if field == "communication_default":
                    comm = data.get("communication", {})
                    if isinstance(comm, dict) and "default" in comm:
                        result[file_key]["communication"] = {"default": comm["default"]}
                elif field in data:
                    result[file_key][field] = data[field]
    
    # Apply topic filter if provided
    if topic:
        result = _filter_by_topic(result, topic.lower())
    
    # Filter inactive items unless requested
    if not include_inactive:
        result = _filter_inactive(result)
    
    # Estimate token count (rough: 4 chars ≈ 1 token)
    json_str = json.dumps(result, ensure_ascii=False)
    token_estimate = len(json_str) // 4
    
    return {
        "scope": scope,
        "scope_description": scope_config["description"],
        "topic_filter": topic,
        "token_estimate": token_estimate,
        "context": result
    }

def _filter_by_topic(data: dict, topic: str) -> dict:
    """Filter context to items relevant to a specific topic."""
    filtered = {}
    
    for key, section in data.items():
        if not isinstance(section, dict):
            continue
            
        filtered[key] = {}
        
        for field, value in section.items():
            if isinstance(value, list):
                # Filter array items by topic relevance
                filtered_items = []
                for item in value:
                    if _item_matches_topic(item, topic):
                        filtered_items.append(item)
                if filtered_items:
                    filtered[key][field] = filtered_items
            elif isinstance(value, dict):
                # Check if dict is topic-relevant
                if _item_matches_topic(value, topic):
                    filtered[key][field] = value
            elif isinstance(value, str):
                # Include string fields if they mention topic
                if topic in value.lower():
                    filtered[key][field] = value
                    
        # Remove empty sections
        if not filtered[key]:
            del filtered[key]
    
    return filtered

def _item_matches_topic(item, topic: str) -> bool:
    """Check if an item is relevant to the given topic."""
    if isinstance(item, str):
        return topic in item.lower()
    elif isinstance(item, dict):
        # Check common fields for topic match
        searchable_fields = ["name", "title", "topic", "description", "notes", "content", "tags"]
        for field in searchable_fields:
            value = item.get(field)
            if isinstance(value, str) and topic in value.lower():
                return True
            elif isinstance(value, list):
                for v in value:
                    if isinstance(v, str) and topic in v.lower():
                        return True
        # Also check references
        for ref in item.get("references", []):
            if _item_matches_topic(ref, topic):
                return True
    return False

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
                # Filter out inactive items
                active_items = []
                for item in value:
                    if isinstance(item, dict):
                        status = item.get("status", "active")
                        # Keep if active or no status field
                        if status in ["active", "open", "exploring", "planning", None]:
                            active_items.append(item)
                        elif status == "completed":
                            # Include completed but maybe summarize later
                            active_items.append(item)
                    else:
                        active_items.append(item)
                if active_items:
                    filtered[key][field] = active_items
            else:
                filtered[key][field] = value
                
        # Remove empty sections
        if not filtered[key]:
            del filtered[key]
    
    return filtered


def get_available_scopes() -> dict:
    """Return available scopes with descriptions for LLM guidance."""
    return {
        scope: {
            "description": config["description"],
            "includes": list(config["fields"].keys()) if config["fields"] != "all" else ["all data"]
        }
        for scope, config in CONTEXT_SCOPES.items()
    }

def get_nested_value(data: dict, path: str):
    """Get a value from nested dict using dot notation path"""
    keys = path.split(".")
    current = data
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(current, list):
            # Try to find by name in list of objects
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
                # Guess if next level should be list or dict
                current[key] = {} 
            current = current.get(key)
        elif isinstance(current, list):
            # Find by name in list
            found = next((item for item in current if isinstance(item, dict) and item.get("name", "").lower() == key.lower()), None)
            if found:
                current = found
            else:
                return False
        if current is None:
            return False
    
    # Set the final value
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

# Initialize MCP server
server = Server("persona-mcp")

@server.list_tools()
async def list_tools():
    """List available MCP tools - consolidated to 10 tools"""
    return [
        # === SMART CONTEXT TOOL (1) - Use this first! ===
        Tool(
            name="get_context",
            description="""🚀 PRIMARY TOOL - Start here for any persona request.

Returns user context with communication preferences. ALWAYS call this at the start of conversations.

WHEN TO USE EACH SCOPE:
• minimal (fastest) - Quick questions, greetings, small talk, code help
  Example: "How do I fix this error?" → Use minimal to get communication style
• professional - Career advice, project help, technical discussions
  Example: "Help me design this API" → Use professional for skills + projects
• personal - Life advice, hobby recommendations, wellness
  Example: "What should I do this weekend?" → Use personal for hobbies + interests
• learning - Learning roadmaps, skill development
  Example: "How should I learn React?" → Use learning for current skills + goals
• full - Complex questions needing complete context
  Example: "Write my resume" → Use full to see everything

PERFORMANCE: Start with minimal, upgrade if you need more context. Smaller scopes = faster + cheaper.

TOPIC FILTER: Add topic="python" to get only Python-related items across all categories.
Example: scope="professional", topic="react" → Only React projects, skills, learning

COMMUNICATION: Result includes user's tone preferences and dislikes - apply these to all responses.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": ["minimal", "professional", "personal", "learning", "full"],
                        "description": "Context depth: minimal | professional | personal | learning | full",
                        "default": "minimal"
                    },
                    "topic": {
                        "type": "string",
                        "description": "Optional: Filter to items matching this topic (e.g., 'python', 'cooking')"
                    },
                    "include_inactive": {
                        "type": "boolean",
                        "description": "Include inactive hobbies, paused projects, etc. Default: false",
                        "default": False
                    }
                },
                "required": []
            }
        ),
        
        # === INDIVIDUAL READ TOOLS (7) - For specific data needs ===
        Tool(
            name="get_persona",
            description="""All persona data. Use get_context for scoped retrieval.
Returns: profile, lifestyle, knowledge, preferences, projects, learning_log.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_profile",
            description="""Raw profile data for editing and deeper specific understanding. Use get_context first for general persona requests.
        Contains: name, bio, contact, languages, education[], work_experience[], career_aspirations[].""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_lifestyle",
            description="""Raw lifestyle data for editing and deeper specific understanding. Use get_context(scope='personal') first for general persona requests.
        Contains: hobbies[], passions[], curiosities[], personality_traits[], values[], wellness.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_knowledge",
            description="""Raw knowledge data for editing and deeper specific understanding. Use get_context(scope='professional') first for general persona requests.
        Contains: domains[] (skills with levels), mental_tabs[] (tracked topics with references).""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_preferences",
            description="""Raw preferences data for editing and deeper specific understanding. Use get_context(scope='minimal') first for general persona requests.
        Contains: code_style, communication (default + mood_overrides), learning_style, dislikes[].""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_projects",
            description="""Raw projects data for editing and deeper specific understanding. Use get_context(scope='professional') first for general persona requests.
        Contains: projects[], current_learning[], top_of_mind[].""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_learning_log",
            description="""Raw learning log for editing and deeper specific understanding. Use get_context(scope='learning') first for general persona requests.
        Contains: entries[] with {timestamp, topic, details, source, tags[]}.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        
        # === WRITE TOOLS (3) ===
        Tool(
            name="persona_update",
            description="""Update a single field using dot-notation path.
Use this for simple field updates when you know the exact path.

Examples:
- profile.location → "London, UK"
- profile.bio → "Updated bio text"
- profile.contact.github → "newusername"  
- lifestyle.hobbies.Gaming.notes → "Playing more lately"
- knowledge.domains.Python.level → "advanced"
- projects.projects.Solterra.status → "completed"

For arrays, use item name as path segment.
For complex operations (add/remove items), use persona_modify instead.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Dot-notation path to the field (e.g., 'profile.bio', 'lifestyle.hobbies.Gaming.skill_level')"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value for the field"
                    }
                },
                "required": ["path", "value"]
            }
        ),
        Tool(
            name="persona_modify",
            description="""Add, update, or remove items from persona data.

ENTITIES BY FILE:
• profile: email, link, language, work_experience, work_highlight, education, career_aspiration
• lifestyle: hobby, hobby_reference, passion, curiosity, personality_trait, value
• knowledge: domain, domain_reference, mental_tab, mental_tab_reference
• projects: project, project_reference, project_highlight, current_learning, top_of_mind
• preferences: dislike, communication_default, mood_override

DATA EXAMPLES (always include identifier + fields to change):
• UPDATE project: {"name": "ProjectName", "status": "active", "notes": "new notes"}
• ADD hobby: {"name": "Photography", "skill_level": "beginner", "status": "active"}
• UPDATE hobby: {"name": "Badminton", "status": "inactive", "notes": "stopped playing"}
• ADD domain: {"name": "Rust", "level": "learning"}
• UPDATE domain: {"name": "Python", "level": "advanced"}
• ADD top_of_mind: {"idea": "Build a blog", "note": "use SvelteKit"}
• ADD dislike: {"dislike": "morning meetings"}
• ADD mood_override: {"mood": "stressed", "tone": "calm", "detail_level": "brief"}
• UPDATE communication_default: {"tone": "friendly", "detail_level": "concise"}

NESTED ITEMS (must include parent identifier):
• work_highlight: {"company": "Honda", "highlight": "Led API migration"}
• project_highlight: {"project_name": "MyApp", "highlight": "Increased performance by 40%"}
• hobby_reference: {"hobby_name": "Coffee", "ref_name": "V60", "notes": "my daily driver"}
• mental_tab_reference: {"title": "Matcha spots", "ref_name": "Ippodo", "notes": "best in London"}

KEY: For UPDATE/REMOVE, the 'name' field identifies WHICH item to modify.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "update", "remove"],
                        "description": "add = create new, update = modify existing, remove = delete"
                    },
                    "entity": {
                        "type": "string",
                        "description": "Entity type: project, hobby, domain, dislike, mood_override, etc."
                    },
                    "data": {
                        "type": "object",
                        "description": "Must include identifier (name/title) + fields to set. Example: {\"name\": \"MyProject\", \"status\": \"active\"}"
                    }
                },
                "required": ["action", "entity", "data"]
            }
        ),
        Tool(
            name="persona_batch",
            description="""Perform multiple persona modifications in one call.

FORMAT: {"operations": [{"action": "add", "entity": "...", "data": {...}}, ...]}

EXAMPLES:
Add multiple work highlights:
{"operations": [
  {"action": "add", "entity": "work_highlight", "data": {"company": "Honda", "highlight": "Led API project"}},
  {"action": "add", "entity": "work_highlight", "data": {"company": "Honda", "highlight": "Built dashboard"}}
]}

Add multiple project highlights:
{"operations": [
  {"action": "add", "entity": "project_highlight", "data": {"project_name": "MyApp", "highlight": "Increased performance by 40%"}},
  {"action": "add", "entity": "project_highlight", "data": {"project_name": "MyApp", "highlight": "Implemented CI/CD pipeline"}}
]}

Each operation has: action (add/update/remove), entity, data.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "operations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["add", "update", "remove"]},
                                "entity": {"type": "string"},
                                "data": {"type": "object"}
                            },
                            "required": ["action", "entity", "data"]
                        },
                        "description": "Array of {action, entity, data} operations"
                    }
                },
                "required": ["operations"]
            }
        ),
        # === SMART CONTEXT CAPTURE ===
        Tool(
            name="suggest_persona_update",
            description="""Call during conversation when user mentions achievements, learning, preferences, or life updates.

Uses sentiment to detect: completions, new skills, preference statements, certifications.
Example: "finished React course" → suggests skill add + certification

Returns: {should_capture, confidence, suggestions: [{action, entity, data}]}
• ≥0.5: Apply via persona_modify, mention casually ("noted!")
• 0.4-0.5: Ask confirmation
• <0.4: Ignore""",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "User message to analyze"},
                    "context": {"type": "string", "description": "Optional conversation context"}
                },
                "required": ["message"]
            }
        )
    ]


@server.list_prompts()
async def list_prompts():
    """List available prompts"""
    return [
        Prompt(
            name="persona-aware-chat",
            description="Chat with automatic persona capture",
            arguments=[]
        )
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: dict | None = None) -> list:
    """Get prompt by name"""
    if name == "persona-aware-chat":
        return [
            PromptMessage(
                role="user",
                content=TextContent(
                    type="text",
                    text="""For each message I send, call suggest_persona_update first.

If confidence ≥0.5: Apply the suggestions via persona_modify, mention it naturally.
If confidence 0.4-0.5: Ask "Want me to remember that you [X]?"
If confidence <0.4: Respond normally, don't mention persona.

Be natural - don't make it feel like a database."""
                )
            )
        ]
    raise ValueError(f"Unknown prompt: {name}")


def get_field(data: dict, *field_names, default=None):
    """Get a field value trying multiple possible field names.
    This handles LLMs that might use different naming conventions."""
    for name in field_names:
        if data.get(name) is not None:
            return data[name]
    return default

# Field name mappings for common entities - LLMs may use any of these
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
}

def normalize_data(data: dict, entity: str) -> dict:
    """Normalize field names in data to canonical form based on entity type.
    This allows LLMs to use various field name conventions."""
    if not isinstance(data, dict):
        return data
    
    normalized = dict(data)  # Copy to avoid mutating original
    
    # Get the appropriate alias list based on entity
    if entity in ["hobby", "hobby_reference", "hobby_specific"]:
        name_aliases = FIELD_ALIASES.get("hobby", FIELD_ALIASES["name"])
    elif entity in ["project", "project_tag", "project_reference"]:
        name_aliases = FIELD_ALIASES.get("project", FIELD_ALIASES["name"])
    elif entity == "email":
        name_aliases = FIELD_ALIASES.get("email", ["address"])
    elif entity == "link":
        # Keep as-is, link uses 'url' and 'label' which are specific
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
    else:
        name_aliases = FIELD_ALIASES["name"]
    
    # Normalize the primary identifier to 'name' (or appropriate canonical field)
    if "name" not in normalized:
        for alias in name_aliases:
            if alias in normalized and alias != "name":
                normalized["name"] = normalized[alias]
                break
    
    # For email entity, normalize to 'address'
    if entity == "email" and "address" not in normalized:
        for alias in FIELD_ALIASES["email"]:
            if alias in normalized and alias != "address":
                normalized["address"] = normalized[alias]
                break
    
    return normalized

# ═══════════════════════════════════════════════════════════════════════════════
# SMART CONTEXT CAPTURE - Intent Classification & Suggestion System
# ═══════════════════════════════════════════════════════════════════════════════

# -----------------------------------------------------------------------------
# Conversation Context - tracks recent mentions for pronoun resolution
# -----------------------------------------------------------------------------

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
        """
        When user says 'it', what are they referring to?
        Priority: project > skill > hobby
        """
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


# -----------------------------------------------------------------------------
# Skill Level Hierarchy
# -----------------------------------------------------------------------------

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
    # Note: 'been' alone is too weak, need more context
    
    # Check for proficiency claims
    proficiency_words = ['comfortable', 'proficient', 'good at', 'expert', 'master', 'fluent', 'solid', 'advanced']
    claims_proficiency = any(word in message_lower for word in proficiency_words)
    
    # Check for starting language
    starting_words = ['trying', 'exploring', 'just started', 'new to', 'picking up', 'getting into', 'diving into']
    is_starting = any(word in message_lower for word in starting_words)
    
    # Conservative level determination
    # Advanced requires: proficiency claim OR (output + duration + NOT starting language)
    if claims_proficiency:
        return "advanced"
    elif has_output and has_duration and not is_starting:
        return "advanced"
    elif has_output and not is_starting:
        return "intermediate"  # One project = intermediate, not advanced
    elif has_output and is_starting:
        return "learning"  # "diving into X and built something" = still learning
    elif has_duration or 'been learning' in message_lower:
        return "learning"
    elif is_starting:
        return "beginner"
    else:
        return "learning"


# -----------------------------------------------------------------------------
# Vague/Generic Names to Ignore - too ambiguous to capture
# -----------------------------------------------------------------------------

IGNORE_VAGUE_NAMES = {
    # Pronouns and references
    "it", "this", "that", "these", "those", "something", "stuff", "things",
    # Generic descriptors
    "small", "little", "quick", "simple", "basic", "cool", "nice", "new",
    # Generic project terms
    "tool", "app", "script", "project", "thing", "code", "program",
    "side project", "small project", "little project", "quick project",
    "cli tool", "web app", "small app", "test app", "demo app",
    # Common fillers
    "a lot", "some stuff", "various things", "other things",
}


# -----------------------------------------------------------------------------
# Explicit State Change Detection - high-confidence patterns
# -----------------------------------------------------------------------------

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
    """
    Detect high-confidence state changes that warrant immediate action.
    These should have >0.80 confidence automatically.
    """
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
                break  # One match per category
    
    return detected


# -----------------------------------------------------------------------------
# Evidence Boost - multiple signals increase confidence
# -----------------------------------------------------------------------------

def calculate_evidence_boost(triggers: list, state_changes: list, has_duration: bool, sentiment_positive: bool) -> float:
    """
    Boost confidence when multiple signals support the same conclusion.
    More conservative to avoid pushing everything to 1.0.
    """
    evidence_count = 0
    
    if len(triggers) > 0:
        evidence_count += 1
    if state_changes:
        evidence_count += 1
    if has_duration:
        evidence_count += 1
    if sentiment_positive:
        evidence_count += 1
    
    # Conservative boost formula - cap at 0.15
    if evidence_count <= 1:
        return 0.0
    else:
        return min(0.05 * (evidence_count - 1), 0.15)


# -----------------------------------------------------------------------------
# Confidence Calculation - balanced sentiment with additive boosts
# -----------------------------------------------------------------------------

SENTIMENT_MULTIPLIERS = {
    "sarcastic": 0.25,      # Heavy penalty
    "very_negative": 0.50,  # Moderate penalty  
    "venting": 0.60,
    "negative": 0.70,
    "hypothetical": 0.35,   # Strong penalty for hypotheticals
    "uncertain": 0.80,
    "questioning": 0.70,
    "neutral": 0.90,
    "declarative": 1.00,    # No change
    "positive": 1.00,
    "very_positive": 1.10   # Small boost
}

TRIGGER_STRENGTH_BOOSTS = {
    "explicit": 0.10,      # "I finished", "I accepted" - reduced from 0.15
    "strong": 0.06,        # "I've been learning" - reduced from 0.10
    "moderate": 0.03,      # "working on" - reduced from 0.05
    "weak": 0.00           # "might try"
}

def calculate_final_confidence_v2(
    base_confidence: float,
    sentiment_type: str,
    trigger_strength: str,
    evidence_boost: float,
    entity_exists: bool,
    recurrence: int = 0
) -> float:
    """
    Revised confidence calculation with balanced sentiment impact.
    
    Formula:
    final = base × sentiment_multiplier + trigger_boost + evidence_boost + existence_boost
    Cap total additive boosts to prevent always hitting 1.0
    """
    score = base_confidence
    
    # 1. Sentiment multiplier (less harsh than before)
    multiplier = SENTIMENT_MULTIPLIERS.get(sentiment_type, 0.85)
    score *= multiplier
    
    # 2. Calculate all additive boosts but cap total
    trigger_boost = TRIGGER_STRENGTH_BOOSTS.get(trigger_strength, 0.0)
    existence_boost = 0.05 if entity_exists else 0.0
    recurrence_boost = 0.08 * min(recurrence - 1, 3) if recurrence >= 2 else 0.0
    
    # Cap total additive boosts at 0.20 to prevent always hitting 1.0
    total_boost = trigger_boost + evidence_boost + existence_boost + recurrence_boost
    capped_boost = min(total_boost, 0.20)
    
    score += capped_boost
    
    # Final cap at 0.98 to never hit exactly 1.0
    return min(max(score, 0.0), 0.98)


# -----------------------------------------------------------------------------
# Entity-Specific Confidence Thresholds
# -----------------------------------------------------------------------------

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
    "mood_override": {"auto": 0.75, "ask": 0.50},
    "passion": {"auto": 0.72, "ask": 0.50},
    "curiosity": {"auto": 0.70, "ask": 0.45},
    "personality_trait": {"auto": 0.80, "ask": 0.55},
}

def get_action_from_confidence(confidence: float, entity_type: str, is_removal: bool = False) -> str:
    """
    Determine action based on confidence + entity type + operation type.
    
    Different thresholds for different operations:
    - Removals: Always ask (even at 0.95) - too important
    - Profile updates: High bar (0.85+) - core identity
    - Hobby additions: Medium bar (0.70+) - less critical
    """
    # Removals always require confirmation
    if is_removal:
        return "ask_user" if confidence >= 0.50 else "ignore"
    
    thresholds = ENTITY_THRESHOLDS.get(entity_type, {"auto": 0.80, "ask": 0.50})
    
    if confidence >= thresholds["auto"]:
        return "auto_apply"
    elif confidence >= thresholds["ask"]:
        return "ask_user"
    else:
        return "ignore"


# -----------------------------------------------------------------------------
# Suggestion Deduplication - merge multiple signals for same entity
# -----------------------------------------------------------------------------

def deduplicate_suggestions(suggestions: list) -> list:
    """
    When multiple suggestions target the same entity, keep the highest confidence one
    and consolidate evidence.
    """
    if not suggestions:
        return suggestions
    
    entity_map = {}
    
    for suggestion in suggestions:
        # Create unique key from entity type + name
        entity_name = suggestion.get('data', {}).get('name', '')
        entity_key = (suggestion['entity'], entity_name.lower())
        
        if entity_key not in entity_map:
            entity_map[entity_key] = suggestion.copy()
            entity_map[entity_key]['evidence'] = [suggestion.get('reason', '')]
        else:
            existing = entity_map[entity_key]
            
            # Merge evidence
            existing['evidence'].append(suggestion.get('reason', ''))
            
            # Keep higher skill level if applicable
            if 'level' in suggestion.get('data', {}):
                current_level = existing['data'].get('level', 'learning')
                new_level = suggestion['data']['level']
                
                if SKILL_HIERARCHY.get(new_level, 0) > SKILL_HIERARCHY.get(current_level, 0):
                    existing['data']['level'] = new_level
            
            # Boost confidence when multiple signals point to same entity
            existing['confidence'] = min(
                existing['confidence'] + 0.15,  # Boost per additional signal
                1.0
            )
    
    return list(entity_map.values())


# -----------------------------------------------------------------------------
# Pronoun Resolution - resolve 'it', 'that', 'this' to actual entities
# -----------------------------------------------------------------------------

PRONOUNS = ['it', 'that', 'this', 'them', 'they', 'one']

def is_pronoun(text: str) -> bool:
    """Check if text is a pronoun"""
    return text.lower().strip() in PRONOUNS

def resolve_pronoun_references(entities: list, message: str, context: ConversationContext) -> list:
    """
    Resolve pronouns (it, that, this) to actual entities from context.
    
    Example:
    "deployed it to production" + recent_context: "working on Solterra"
    → Resolve "it" to "Solterra"
    """
    resolved = []
    
    for entity in entities:
        entity_value = entity.get('value', '').lower().strip()
        
        # Check if entity is just a pronoun
        if is_pronoun(entity_value):
            # Try to resolve from conversation context
            referent = context.get_likely_referent(entity_value)
            if referent:
                entity = entity.copy()
                entity['value'] = referent
                entity['resolved_from_pronoun'] = True
                entity['confidence'] = entity.get('confidence', 0.7) * 0.8  # Slight penalty
            else:
                # Can't resolve - skip this entity
                continue
        
        # Check if entity contains pronoun + other words (e.g., "it to production")
        elif any(pronoun in entity_value.split() for pronoun in PRONOUNS):
            # Filter out the pronoun, keep the rest
            words = [w for w in entity_value.split() if w.lower() not in PRONOUNS]
            if len(words) >= 2:
                entity = entity.copy()
                entity['value'] = ' '.join(words)
                entity['filtered_pronoun'] = True
            else:
                # Too short after filtering - skip
                continue
        
        resolved.append(entity)
    
    return resolved


# -----------------------------------------------------------------------------
# Persona Cross-Reference - ADD vs UPDATE vs SKIP logic
# -----------------------------------------------------------------------------

def find_in_persona(persona: dict, entity_type: str, name: str) -> dict:
    """Search persona for existing entity by type and name"""
    if not name:
        return None
    
    name_lower = name.lower()
    
    # Map entity types to persona paths
    search_paths = {
        "domain": ("knowledge", "domains"),
        "hobby": ("lifestyle", "hobbies"),
        "project": ("projects", "projects"),
        "passion": ("lifestyle", "passions"),
        "curiosity": ("lifestyle", "curiosities"),
        "personality_trait": ("lifestyle", "personality_traits"),
        "dislike": ("preferences", "dislikes"),
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
    
    # Find existing entity
    existing = find_in_persona(persona, entity_type, name)
    
    if existing:
        # Entity exists - should be UPDATE, not ADD
        if suggestion['action'] == 'add':
            suggestion['action'] = 'update'
            suggestion['confidence'] += 0.10  # Boost for updating existing
            suggestion['reason'] = suggestion.get('reason', '') + " (updating existing entry)"
        
        # Check for skill level conflicts
        if 'level' in data and 'level' in existing:
            current = SKILL_HIERARCHY.get(existing['level'], 0)
            proposed = SKILL_HIERARCHY.get(data['level'], 0)
            
            if proposed < current:
                # Downgrade detected - reduce confidence, require confirmation
                suggestion['confidence'] = min(suggestion['confidence'], 0.65)
                suggestion['conflict'] = {
                    "field": "level",
                    "current": existing['level'],
                    "proposed": data['level'],
                    "requires_confirmation": True
                }
        
        # Check if data is actually different
        if is_same_data(existing, data):
            suggestion['action'] = 'skip'
            suggestion['confidence'] = 0.0
            suggestion['reason'] = "Data unchanged from existing"
    
    else:
        # New entity - ADD is correct
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
# UX Consolidation - group suggestions for better prompts
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
        # ignore actions are not included
    
    # If 3+ updates in ask_user, batch them
    if len(ask_user) >= 3:
        return {
            "auto_apply": auto_apply,
            "batch_confirm": ask_user,
            "individual_confirm": [],
            "ui_hint": "batch_prompt"  # Show single confirmation dialog
        }
    else:
        return {
            "auto_apply": auto_apply,
            "batch_confirm": [],
            "individual_confirm": ask_user,
            "ui_hint": "inline_prompts"  # Show individual confirmations
        }


# Trigger phrases that indicate persona-worthy content
CAPTURE_TRIGGERS = {
    "state_change": [
        # Completion
        "just finished", "finally finished", "completed", "done with", "wrapped up",
        "finished up", "got done with", "managed to finish", "just completed",
        # Starting
        "started", "began", "just started", "recently started", "been starting",
        "kicked off", "getting started with", "starting to",
        # Stopping
        "stopped", "quit", "dropped", "gave up on", "no longer doing",
        "decided to stop", "not doing anymore", "taking a break from",
        # Switching
        "switched to", "moved to", "transitioned to", "changed to",
        "migrated to", "moving away from", "switching from",
    ],
    "learning": [
        # Active learning
        "learning", "studying", "getting into", "diving into", "exploring",
        "picked up", "been learning", "currently learning", "started learning",
        "teaching myself", "taught myself", "figured out", "understanding",
        # Progress
        "getting better at", "improving at", "improving my", "practicing",
        "making progress with", "getting the hang of", "finally getting",
        # Discovery
        "discovered", "found out about", "came across", "stumbled upon",
        "realizing", "starting to understand",
    ],
    "skill_level": [
        # High proficiency
        "i'm comfortable with", "comfortable with", "i'm good at", "good at",
        "i'm fluent in", "fluent in", "pretty good at", "really good at",
        "expert in", "advanced in", "proficient in", "solid at", "strong at",
        "confident with", "i know my way around",
        # Medium proficiency
        "decent at", "intermediate at", "getting comfortable with",
        "fairly good at", "okay at", "alright at", "know enough",
        # Low proficiency
        "beginner at", "novice at", "just starting with", "new to",
        "still learning", "not great at", "struggling with",
    ],
    "identity": [
        # Direct identity
        "i'm a", "i am a", "i consider myself", "i identify as",
        "i've become", "now i'm", "these days i'm", "i'm more of a",
        # Negative identity (personality type)
        "not a morning person", "not a night person", "not a people person",
        "not an early bird", "night owl", "early bird",
        "i'm not a", "i am not a", "not really a", "never been a",
        "i'm the type who", "i'm someone who", "kind of person who",
        # Self-description
        "i tend to", "i usually", "i always", "i never",
        "one of those people who", "the kind of person",
    ],
    "preference": [
        # Positive preferences
        "i prefer", "i like", "i love", "i enjoy", "i'm into",
        "fan of", "big fan of", "huge fan of", "i'm fond of",
        "really like", "really love", "really enjoy", "quite like",
        "i appreciate", "i value", "i dig", "i'm all about",
        "my go-to", "go-to", "my favorite", "favourite", "main choice",
        # Negative preferences  
        "i hate", "i don't like", "i can't stand", "i avoid",
        "not a fan of", "never liked", "always hated", "drives me crazy",
        "annoys me", "bothers me", "bugs me", "irritates me",
        # Pronoun-based (requires context)
        "hate them", "love them", "can't stand them", "love it", "hate it",
        # Emotional reactions
        "annoyed with", "annoyed by", "frustrated with", "frustrated by",
        "getting annoyed", "getting frustrated", "fed up with", "sick of",
        "tired of", "over it", "so done with",
    ],
    "goal": [
        # Aspirations
        "want to", "wanna", "planning to", "plan to", "goal is", "my goal is",
        "trying to", "hoping to", "hope to", "aiming to", "aim to",
        "working towards", "working on becoming", "working to",
        # Dreams
        "dream of", "dreaming of", "dream is to", "aspire to", "aspiration is",
        "would love to", "someday want to", "eventually want to",
        # Intentions
        "going to", "gonna", "intend to", "thinking of", "considering",
        "looking to", "looking into", "might start",
    ],
    "interest": [
        # Curiosity
        "interested in", "curious about", "fascinated by", "intrigued by",
        "wondering about", "keen on", "keen to learn",
        # Passion
        "passionate about", "obsessed with", "really into", "super into",
        "deep into", "heavily into", "all about", "crazy about",
        # Exploration
        "been exploring", "exploring", "looking into", "checking out",
        "getting curious about", "starting to get into",
    ],
    "achievement": [
        # Creation
        "built", "created", "made", "developed", "designed", "wrote",
        "implemented", "coded", "programmed", "put together",
        # Completion
        "achieved", "accomplished", "completed", "finished", "delivered",
        "launched", "shipped", "released", "published", "deployed",
        # Success
        "won", "got", "earned", "received", "landed", "nailed",
        "pulled off", "managed to", "succeeded in",
        # Life events - job/education
        "accepted", "got accepted", "hired", "got hired", "got the job",
        "promoted", "got promoted", "graduated", "passed", "certified",
    ],
    "wellness": [
        # Sleep
        "go to bed at", "wake up at", "sleep at", "get up at",
        "usually sleep", "usually wake", "bedtime is", "i sleep around",
        # Energy
        "most productive", "energy peaks", "feel energized", "work best",
        "in the zone", "focus best", "peak productivity",
        "after coffee", "after lunch", "in the morning", "at night",
        "late night", "early morning",
    ],
}

# Phrases that indicate NON-capture-worthy content
IGNORE_PATTERNS = [
    # Questions (seeking info, not providing it)
    "how do i", "how can i", "what is", "what are", "can you", "could you",
    "tell me about", "explain", "help me with", "show me", "teach me",
    "what does", "what's the difference", "should i",
    # Momentary states (not persistent)
    "i'm tired", "i'm hungry", "i'm bored", "feeling sick", "feeling down",
    "today i feel", "right now i", "at the moment",
    # Hypotheticals
    "what if", "if i were", "imagine if", "suppose", "theoretically",
    "hypothetically", "in theory", "would it be",
    # External info requests
    "what's the", "where is", "when is", "who is", "why is", "why does",
    # Casual chat
    "thanks", "thank you", "bye", "goodbye", "see you", "talk later",
    "okay", "ok", "alright", "sure", "sounds good", "got it",
    # Past temporary states
    "yesterday i felt", "this morning i was", "earlier i was",
    # General inquiries
    "is there", "are there", "do you know", "have you heard",
]

# Common skill/technology terms for entity detection
KNOWN_SKILLS = [
    # Programming Languages
    "python", "javascript", "typescript", "rust", "go", "golang", "java",
    "c++", "cpp", "c#", "csharp", "swift", "kotlin", "ruby", "php",
    "scala", "elixir", "haskell", "lua", "perl", "r lang", "julia",
    "objective-c", "dart", "clojure", "f#",
    # Frontend Frameworks
    "react", "reactjs", "vue", "vuejs", "svelte", "angular", "solid",
    "preact", "ember", "backbone", "alpine", "htmx", "astro",
    # Meta Frameworks
    "nextjs", "next.js", "nuxt", "nuxtjs", "sveltekit", "remix",
    "gatsby", "blitz", "redwood",
    # Backend Frameworks
    "django", "flask", "fastapi", "express", "expressjs", "nestjs",
    "rails", "ruby on rails", "spring", "spring boot", "dotnet", ".net",
    "laravel", "phoenix", "gin", "echo", "fiber", "actix", "axum",
    # Mobile
    "react native", "flutter", "swiftui", "jetpack compose", "ionic",
    "xamarin", "capacitor", "expo",
    # DevOps & Cloud
    "docker", "kubernetes", "k8s", "aws", "amazon web services",
    "gcp", "google cloud", "azure", "vercel", "netlify", "railway",
    "heroku", "digitalocean", "linode", "terraform", "ansible",
    "jenkins", "github actions", "gitlab ci", "circleci",
    # Tools & Editors
    "git", "github", "gitlab", "bitbucket", "figma", "sketch",
    "notion", "obsidian", "vscode", "vs code", "vim", "neovim",
    "intellij", "webstorm", "pycharm", "xcode", "android studio",
    # Databases
    "sql", "mysql", "postgres", "postgresql", "mongodb", "mongo",
    "redis", "elasticsearch", "dynamodb", "firebase", "supabase",
    "prisma", "drizzle", "sqlite", "cassandra", "neo4j",
    # APIs & Data
    "graphql", "rest", "restful", "api", "grpc", "websocket",
    "trpc", "apollo", "urql",
    # AI/ML
    "ai", "artificial intelligence", "machine learning", "ml", "deep learning",
    "llm", "large language model", "gpt", "openai", "anthropic", "claude",
    "langchain", "llamaindex", "hugging face", "pytorch", "tensorflow",
    "mcp", "model context protocol",
    # CSS & Styling
    "tailwind", "tailwindcss", "css", "sass", "scss", "less",
    "styled components", "emotion", "chakra", "material ui", "bootstrap",
    # Build Tools
    "webpack", "vite", "esbuild", "rollup", "parcel", "turbopack",
    "bun", "deno", "npm", "yarn", "pnpm",
    # Testing
    "jest", "vitest", "cypress", "playwright", "selenium",
    "pytest", "unittest", "mocha", "chai",
]


# -----------------------------------------------------------------------------
# Sentiment & Statement Quality Analysis
# -----------------------------------------------------------------------------

def analyze_statement_quality(message: str, context: str = "") -> dict:
    """
    Analyze the quality and intent of a statement to determine if it's
    a genuine personal declaration worth capturing.
    
    Returns:
        statement_type: declarative, hypothetical, venting, questioning, casual
        confidence_modifier: 0.0-1.0 multiplied with trigger confidence
        reasoning: Why this classification
        self_reference: Does it reference self?
        temporal_anchor: past, present, future, or None
    """
    
    # Self-reference detection - personal statements are more valuable
    self_markers = [
        "i ", "i'm", "i've", "i'd", "i'll", "my ", "me ", "myself",
        "i am", "i have", "i was", "i will", "i would", "i could",
    ]
    has_self_reference = any(marker in message for marker in self_markers)
    
    # Statement type markers
    hypothetical_markers = [
        "what if", "if i were", "if i was", "if only", "imagine if",
        "hypothetically", "in theory", "theoretically", "supposedly",
        "i might", "i could", "maybe i", "perhaps i", "possibly",
        "i wonder if i", "not sure if i", "i don't know if",
        "thinking about maybe", "considering maybe",
        "would it be", "should i maybe", "what would happen if",
    ]
    
    # 2. VENTING/EMOTIONAL RELEASE markers (medium-low confidence)
    venting_markers = [
        "ugh", "argh", "omg", "fml", "smh", "bruh",
        "i can't believe", "so annoyed", "so frustrated", "so tired of",
        "why does", "why can't", "why won't", "why do i",
        "this is ridiculous", "this is insane", "this is crazy",
        "i just can't", "i literally can't", "literally dying",
        "kill me", "end me", "i'm done", "i'm dead",
        "having a moment", "just venting", "need to vent",
        "rant incoming", "mini rant", "sorry for the rant",
    ]
    
    questioning_markers = [
        "?", "should i", "do you think i", "would you recommend",
        "what do you think about", "any advice on", "any tips for",
        "how do i", "how should i", "how can i",
        "is it worth", "is it a good idea", "does it make sense",
        "am i wrong to", "am i crazy for", "is it just me",
    ]
    
    casual_markers = [
        "lol", "lmao", "haha", "hehe", "jk", "just kidding",
        "idk", "tbh", "ngl", "imo", "btw", "fwiw",
        "you know", "like", "just saying", "whatever",
        "anyway", "anywho", "so yeah", "but yeah",
        "random thought", "random but", "off topic but",
    ]
    
    declarative_markers = [
        "i am", "i'm a", "i have been", "i've been", "i've always",
        "i always", "i never", "i definitely", "i absolutely",
        "i officially", "i finally", "i just finished", "i completed",
        "i realized", "i discovered", "i learned that i",
        "i'm confident that", "i know for sure", "i'm certain",
        "i decided", "i made the decision", "i committed to",
        "i started", "i began", "i'm now", "these days i",
        "for the past", "for years i've", "since i was",
    ]
    
    # Temporal anchoring - affects permanence
    past_markers = [
        "used to", "back when", "when i was", "years ago", "last year",
        "previously", "before i", "in the past", "historically",
    ]
    present_markers = [
        "currently", "right now", "these days", "nowadays", "at the moment",
        "i'm currently", "i am now", "i've become", "i've grown to",
    ]
    future_markers = [
        "someday", "one day", "eventually", "in the future", "going to",
        "planning to", "hoping to", "want to eventually", "will be",
    ]
    
    # Classification logic
    statement_type = "neutral"
    confidence_modifier = 0.5
    reasoning = []
    temporal_anchor = None
    
    # Temporal anchoring
    if any(m in message for m in present_markers):
        temporal_anchor = "present"
        confidence_modifier += 0.1
        reasoning.append("present-tense statement")
    elif any(m in message for m in past_markers):
        temporal_anchor = "past"
        confidence_modifier += 0.05
        reasoning.append("past experience")
    elif any(m in message for m in future_markers):
        temporal_anchor = "future"
        reasoning.append("future aspiration")
    
    # Self-reference check
    if has_self_reference:
        confidence_modifier += 0.15
        reasoning.append("self-referential")
    else:
        confidence_modifier -= 0.2
        reasoning.append("no self-reference")
    
    # Statement type classification (priority: hypothetical > venting > questioning > declarative)
    is_hypothetical = any(m in message for m in hypothetical_markers)
    starts_hypothetical = message.strip().startswith(("what if", "if i", "imagine if", "hypothetically"))
    is_venting = any(m in message for m in venting_markers)
    is_questioning = any(m in message for m in questioning_markers)
    is_declarative = any(m in message for m in declarative_markers)
    
    if is_hypothetical or starts_hypothetical:
        statement_type = "hypothetical"
        confidence_modifier -= 0.3
        reasoning.append("hypothetical/speculative")
    elif is_venting:
        statement_type = "venting"
        confidence_modifier -= 0.15
        reasoning.append("venting/emotional release")
        if is_declarative:
            confidence_modifier += 0.1
            reasoning.append("but declarative tone")
    elif is_questioning:
        if has_self_reference and is_declarative:
            statement_type = "question_with_statement"
            confidence_modifier += 0.0  # Neutral
            reasoning.append("question containing statement")
        else:
            statement_type = "questioning"
            confidence_modifier -= 0.25
            reasoning.append("seeking advice/asking question")
    elif is_declarative:
        statement_type = "declarative"
        confidence_modifier += 0.25
        reasoning.append("declarative statement")
    
    # Casual markers slightly reduce confidence
    casual_count = sum(1 for m in casual_markers if m in message)
    if casual_count >= 2:
        confidence_modifier -= 0.1
        reasoning.append("casual tone")
    
    # Normalize to 0.0 - 1.0 range
    confidence_modifier = max(0.0, min(1.0, confidence_modifier))
    
    return {
        "statement_type": statement_type,
        "confidence_modifier": confidence_modifier,
        "reasoning": "; ".join(reasoning) if reasoning else "neutral statement",
        "self_reference": has_self_reference,
        "temporal_anchor": temporal_anchor,
    }


def analyze_message_for_capture(message: str, context: str = "") -> dict:
    """
    Analyze a user message to detect persona-worthy information.
    
    Uses SENTENCE-LEVEL analysis with best-of fallback:
    1. Analyze each sentence separately
    2. Analyze the full message as a whole
    3. Return the result with highest confidence
    
    This prevents questions at the end from killing good persona statements earlier.
    """
    
    # Split into sentences (handle ., !, ?, and multiple punctuation)
    sentences = re.split(r'(?<=[.!?])\s+', message.strip())
    sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 10]
    
    # If message is short or just one sentence, analyze as-is
    if len(sentences) <= 1:
        return _analyze_single_message(message, context)
    
    # Analyze each sentence AND the full message
    all_results = []
    
    # Analyze full message first
    full_result = _analyze_single_message(message, context)
    full_result["_source"] = "full_message"
    all_results.append(full_result)
    
    # Analyze each sentence
    for i, sentence in enumerate(sentences):
        sentence_result = _analyze_single_message(sentence, context)
        sentence_result["_source"] = f"sentence_{i+1}"
        all_results.append(sentence_result)
    
    # Find the best result (highest confidence with suggestions)
    results_with_suggestions = [r for r in all_results if r.get("suggestions")]
    
    if results_with_suggestions:
        # Pick the one with highest confidence
        best = max(results_with_suggestions, key=lambda r: r["confidence"])
    else:
        # No suggestions anywhere, return full message analysis
        best = full_result
    
    # Merge: keep best result but note if it came from sentence-level
    if best["_source"] != "full_message" and best["confidence"] > full_result["confidence"]:
        best["analysis_note"] = f"Sentence-level analysis improved confidence ({best['_source']})"
        # Also merge any unique triggers/suggestions from other sentences
        all_triggers = set()
        all_suggestions = []
        seen_entities = set()
        
        for r in results_with_suggestions:
            all_triggers.update(r.get("detected_triggers", []))
            for s in r.get("suggestions", []):
                entity_key = (s["action"], s["entity"], str(s["data"]))
                if entity_key not in seen_entities:
                    seen_entities.add(entity_key)
                    all_suggestions.append(s)
        
        best["detected_triggers"] = list(all_triggers)
        best["suggestions"] = sorted(all_suggestions, key=lambda s: s["confidence"], reverse=True)
        # Recalculate overall confidence from merged suggestions
        if best["suggestions"]:
            best["confidence"] = max(s["confidence"] for s in best["suggestions"])
            best["should_capture"] = best["confidence"] >= 0.4
    
    # Clean up internal field
    best.pop("_source", None)
    
    return best


def _analyze_single_message(message: str, context: str = "") -> dict:
    """
    Core analysis for a single message/sentence. Uses sentiment-aware analysis
    to distinguish genuine personal statements from venting/hypotheticals.
    
    Returns: {should_capture, confidence, suggestions[], detected_triggers[], 
              detected_entities[], sentiment{}, ignore_reason}
    """
    message_lower = message.lower()
    full_context = f"{context}\n{message}".lower() if context else message_lower
    
    result = {
        "should_capture": False,
        "confidence": 0.0,
        "suggestions": [],
        "detected_triggers": [],
        "detected_entities": [],
        "sentiment": {},
        "ignore_reason": None
    }
    
    # Step 0: Sentiment & statement quality analysis
    sentiment = analyze_statement_quality(message_lower, full_context)
    result["sentiment"] = sentiment
    
    # If statement quality is too low, don't bother with triggers
    if sentiment["confidence_modifier"] < 0.3:
        result["ignore_reason"] = f"Low statement quality: {sentiment['reasoning']}"
        result["confidence"] = sentiment["confidence_modifier"]
        return result
    
    # =========================================================================
    # STEP 1: Detect triggers (keywords that suggest persona info)
    # =========================================================================
    trigger_categories = []
    for category, phrases in CAPTURE_TRIGGERS.items():
        for phrase in phrases:
            if phrase in message_lower:
                trigger_categories.append(category)
                result["detected_triggers"].append(f"{category}: {phrase}")
                break
    
    # Check ignore patterns only if no triggers found
    matched_ignore = None
    for pattern in IGNORE_PATTERNS:
        if pattern in message_lower:
            matched_ignore = pattern
            break
    
    if matched_ignore and not trigger_categories:
        result["ignore_reason"] = f"Matched ignore pattern: '{matched_ignore}'"
        result["confidence"] = 0.1
        return result
    
    # Load current persona for overlap detection
    persona = get_all_persona_data()
    existing_domains = [d.get("name", "").lower() for d in persona.get("knowledge", {}).get("domains", [])]
    existing_hobbies = [h.get("name", "").lower() for h in persona.get("lifestyle", {}).get("hobbies", [])]
    existing_projects = [p.get("name", "").lower() for p in persona.get("projects", {}).get("projects", [])]
    existing_passions = [p.lower() for p in persona.get("lifestyle", {}).get("passions", [])]
    existing_curiosities = [c.lower() for c in persona.get("lifestyle", {}).get("curiosities", [])]
    existing_dislikes = [d.lower() for d in persona.get("preferences", {}).get("dislikes", [])]
    existing_traits = [t.lower() for t in persona.get("lifestyle", {}).get("personality_traits", [])]
    
    # Detect entities with word boundary matching (prevents "ember" from "September")
    detected_skills = []
    for skill in KNOWN_SKILLS:
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, message_lower, re.IGNORECASE):
            detected_skills.append(skill.title() if len(skill) > 3 else skill.upper())
            result["detected_entities"].append(f"skill: {skill}")
    
    # Generate suggestions
    suggestions = []
    state_changes = detect_explicit_state_changes(message_lower)
    
    # Evidence tracking
    duration_words = ['months', 'weeks', 'regularly', 'for years', 'for a while', 'been']
    has_duration = any(word in message_lower for word in duration_words)
    sentiment_positive = sentiment["statement_type"] in ["declarative", "positive"] and sentiment["confidence_modifier"] >= 0.6
    
    # Learning triggers + skill detected = suggest adding domain
    if "learning" in trigger_categories and detected_skills:
        for skill in detected_skills:
            skill_lower = skill.lower()
            
            # Use smart skill level determination (Fix #8)
            inferred_level = determine_skill_level(skill, message, result["detected_triggers"])
            
            if skill_lower in existing_domains:
                # Already exists - maybe update level?
                if any(phrase in message_lower for phrase in ["getting better", "comfortable", "good at", "improving"]):
                    suggestions.append({
                        "action": "update",
                        "entity": "domain",
                        "data": {"name": skill, "level": inferred_level},
                        "reason": f"Learning progress mentioned for existing skill: {skill}",
                        "confidence": 0.75
                    })
            else:
                suggestions.append({
                    "action": "add",
                    "entity": "domain",
                    "data": {"name": skill, "level": inferred_level},  # Use smart skill level
                    "reason": f"New learning activity detected: {skill}",
                    "confidence": 0.8
                })
    
    # Hobby detection (learning triggers for non-tech activities)
    if "learning" in trigger_categories and not detected_skills:
        # No tech skills detected, might be a hobby
        hobby_phrases = [
            "picked up", "started doing", "getting into", "got into", "been doing",
            "taking up", "took up", "trying out", "started with"
        ]
        for phrase in hobby_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                # Extract the hobby name (first few words after phrase)
                hobby_words = after.split()[:3]
                hobby = " ".join(hobby_words).rstrip(".,!?")
                # Filter out common filler words at start
                filler_words = ["a", "an", "the", "some", "this", "that"]
                first_word = hobby.split()[0] if hobby.split() else ""
                if first_word.lower() in filler_words:
                    hobby = " ".join(hobby.split()[1:])
                if hobby and len(hobby) > 2:
                    suggestions.append({
                        "action": "add",
                        "entity": "hobby",
                        "data": {"name": hobby.title(), "status": "active"},
                        "reason": f"New hobby mentioned: {hobby}",
                        "confidence": 0.75
                    })
                break
    
    # Skill level triggers = suggest updating domain level
    if "skill_level" in trigger_categories:
        for skill in detected_skills:
            skill_lower = skill.lower()
            level = "intermediate"  # Default
            if any(p in message_lower for p in ["advanced", "expert", "fluent"]):
                level = "advanced"
            elif any(p in message_lower for p in ["beginner", "novice", "just started"]):
                level = "learning"
            
            if skill_lower in existing_domains:
                suggestions.append({
                    "action": "update",
                    "entity": "domain",
                    "data": {"name": skill, "level": level},
                    "reason": f"Skill level update: {skill} → {level}",
                    "confidence": 0.85
                })
            else:
                suggestions.append({
                    "action": "add",
                    "entity": "domain",
                    "data": {"name": skill, "level": level},
                    "reason": f"New skill with level: {skill} ({level})",
                    "confidence": 0.8
                })
    
    # State change triggers (completed, finished, stopped, etc.)
    if "state_change" in trigger_categories:
        completion_phrases = ["finished", "completed", "done with", "wrapped up", "just finished"]
        if any(phrase in message_lower for phrase in completion_phrases):
            # Look for project names in existing projects
            for project in persona.get("projects", {}).get("projects", []):
                proj_name = project.get("name", "")
                if proj_name.lower() in message_lower:
                    suggestions.append({
                        "action": "update",
                        "entity": "project",
                        "data": {"name": proj_name, "status": "completed"},
                        "reason": f"Explicit completion: {proj_name}",
                        "confidence": 0.95
                    })
        
        # Handle stop/quit phrases - suggest removal from hobbies/activities
        stop_phrases = [
            ("stopped playing", "after"),
            ("stopped doing", "after"),
            ("quit playing", "after"),
            ("quit doing", "after"),
            ("stopped", "after"),
            ("quit", "after"),
            ("gave up on", "after"),
            ("gave up", "after"),
            ("no longer doing", "after"),
            ("not doing anymore", "before"),
            ("dropped", "after"),
            ("lost interest in", "after"),
            ("taking a break from", "after"),
        ]
        
        from datetime import datetime
        current_date = datetime.now().strftime("%B %Y")
        
        for phrase, direction in stop_phrases:
            if phrase in message_lower:
                if direction == "after":
                    after = message_lower.split(phrase, 1)[1].strip()
                    activity = " ".join(after.split()[:4]).rstrip(".,!?")
                else:
                    before = message_lower.split(phrase, 1)[0].strip()
                    activity = " ".join(before.split()[-4:]).rstrip(".,!?")
                
                if activity and len(activity) > 2:
                    # Check if it matches an existing hobby - UPDATE with note instead of removing
                    for hobby in persona.get("lifestyle", {}).get("hobbies", []):
                        hobby_name = hobby.get("name", "") if isinstance(hobby, dict) else str(hobby)
                        if hobby_name.lower() in activity or activity in hobby_name.lower():
                            # Add note about stopping instead of removing
                            note = f"Not actively doing this anymore (as of {current_date})"
                            suggestions.append({
                                "action": "update",
                                "entity": "hobby",
                                "data": {"name": hobby_name, "status": "inactive", "notes": note},
                                "reason": f"User stopped: {phrase} {activity} - adding note instead of removing",
                                "confidence": 0.88
                            })
                            break
                    else:
                        # Not in persona yet - still worth noting they stopped something
                        note = f"Mentioned stopping this activity ({current_date})"
                        suggestions.append({
                            "action": "add",
                            "entity": "hobby",
                            "data": {"name": activity.title(), "status": "inactive", "notes": note},
                            "reason": f"User mentioned stopping: {phrase} {activity}",
                            "confidence": 0.75
                        })
                break  # Only match first stop phrase
    
    # Preference triggers
    if "preference" in trigger_categories:
        # Detect dislikes - expanded phrases with direction
        dislike_phrases = [
            # (phrase, direction, confidence)
            ("i hate", "after", 0.8),
            ("always hated", "after", 0.85),
            ("i don't like", "after", 0.75),
            ("never liked", "after", 0.8),
            ("can't stand", "after", 0.8),
            ("i avoid", "after", 0.7),
            ("not a fan of", "after", 0.75),
            ("drives me crazy", "before", 0.75),
            ("annoys me", "before", 0.7),
            ("bothers me", "before", 0.7),
            ("bugs me", "before", 0.7),
            ("irritates me", "before", 0.7),
            ("sick of", "after", 0.75),
            ("tired of", "after", 0.7),
            ("fed up with", "after", 0.75),
            ("so done with", "after", 0.75),
            ("over it", "before", 0.6),
            # Pronoun-based (context-dependent)
            ("hate them", "before", 0.75),
            ("can't stand them", "before", 0.75),
            ("hate it", "before", 0.7),
            # Emotional reactions
            ("annoyed with", "after", 0.7),
            ("annoyed by", "after", 0.7),
            ("frustrated with", "after", 0.7),
            ("frustrated by", "after", 0.7),
            ("getting annoyed", "after", 0.65),
            ("getting frustrated", "after", 0.65),
        ]
        
        for phrase, direction, conf in dislike_phrases:
            if phrase in message_lower:
                if direction == "after":
                    after = message_lower.split(phrase, 1)[1].strip()
                    dislike_item = " ".join(after.split()[:5]).rstrip(".,!?")
                else:
                    # Look backwards for noun phrase
                    before = message_lower.split(phrase, 1)[0].strip()
                    
                    # Common patterns to match
                    noun_patterns = [
                        r'(\w+\s+meetings?)',
                        r'(meetings?\s+at\s+\w+)',
                        r'(\w+\s+calls?)',
                        r'(\w+\s+standups?)',
                        r'(\w+\s+emails?)',
                        r'(early\s+\w+)',
                        r'(late\s+\w+)',
                        r'(long\s+\w+)',
                    ]
                    
                    dislike_item = None
                    for pattern in noun_patterns:
                        matches = re.findall(pattern, before)
                        if matches:
                            dislike_item = matches[-1].strip()
                            break
                    
                    # Fallback: common dislikable nouns
                    if not dislike_item:
                        keywords = ["meetings", "calls", "standup", "standups", "syncs", "emails", "deadlines", "commute", "traffic"]
                        for kw in keywords:
                            if kw in before:
                                words = before.split()
                                for i, w in enumerate(words):
                                    if kw in w:
                                        if i > 0 and words[i-1] not in ["the", "a", "an", "with", "and", "or"]:
                                            dislike_item = f"{words[i-1]} {w}"
                                        else:
                                            dislike_item = w
                                        break
                                break
                    
                    if not dislike_item:
                        dislike_item = ""
                
                # Filter out false positives
                skip_items = ["person", "people", "a person", "the person", "it", "them", "that", "this"]
                if dislike_item and len(dislike_item) > 2 and dislike_item.lower() not in skip_items:
                    if dislike_item.lower() not in existing_dislikes:
                        suggestions.append({
                            "action": "add",
                            "entity": "dislike",
                            "data": {"dislike": dislike_item},
                            "reason": f"Negative preference: '{dislike_item}'",
                            "confidence": conf
                        })
                break
        
        # Detect positive preferences for skills
        like_phrases = [
            "i prefer", "i like", "i love", "i enjoy", "i'm into",
            "fan of", "big fan of", "huge fan of", "really like", "really love",
            "really enjoy", "i appreciate", "i dig", "i'm all about",
            "my go-to", "go-to", "my favorite", "favourite", "main choice",
        ]
        if any(phrase in message_lower for phrase in like_phrases):
            for skill in detected_skills:
                if skill.lower() not in existing_domains:
                    suggestions.append({
                        "action": "add",
                        "entity": "domain",
                        "data": {"name": skill, "level": "learning", "notes": "Expressed preference"},
                        "reason": f"Positive preference for: {skill}",
                        "confidence": 0.65
                    })
                else:
                    # Already exists - add as a passion/like instead
                    if skill.lower() not in existing_passions:
                        suggestions.append({
                            "action": "add",
                            "entity": "passion",
                            "data": {"passion": skill},
                            "reason": f"Expressed love for existing skill: {skill}",
                            "confidence": 0.6
                        })
    
    # Identity triggers - detect personality traits
    if "identity" in trigger_categories:
        # Specific "not a X person" patterns
        identity_patterns = [
            ("not a morning person", "not a morning person", 0.85),
            ("not a night person", "not a night person", 0.85),
            ("not a people person", "not a people person", 0.85),
            ("not an early bird", "not an early bird", 0.8),
            ("night owl", "night owl", 0.8),
            ("early bird", "early bird", 0.8),
            ("introvert", "introverted", 0.75),
            ("extrovert", "extroverted", 0.75),
            ("i'm introverted", "introverted", 0.8),
            ("i'm extroverted", "extroverted", 0.8),
        ]
        
        for pattern, trait, conf in identity_patterns:
            if pattern in message_lower:
                if trait.lower() not in existing_traits:
                    suggestions.append({
                        "action": "add",
                        "entity": "personality_trait",
                        "data": {"trait": trait},
                        "reason": f"Self-identified trait: {trait}",
                        "confidence": conf
                    })
                break
        
        # "I'm a X" pattern - extract the X
        identity_starters = ["i'm a ", "i am a ", "i consider myself ", "i'm more of a "]
        for starter in identity_starters:
            if starter in message_lower:
                after = message_lower.split(starter, 1)[1].strip()
                identity = " ".join(after.split()[:3]).rstrip(".,!?")
                # Only add if it looks like a role/identity
                if identity and len(identity) > 2:
                    role_words = ["developer", "designer", "engineer", "person", "type", "learner", "thinker", "maker", "builder", "creator"]
                    if any(rw in identity for rw in role_words):
                        if identity.lower() not in existing_traits:
                            suggestions.append({
                                "action": "add",
                                "entity": "personality_trait",
                                "data": {"trait": identity},
                                "reason": f"Self-identified as: {identity}",
                                "confidence": 0.7
                            })
                break
    
    # Interest/curiosity triggers
    if "interest" in trigger_categories:
        curiosity_phrases = ["curious about", "interested in", "fascinated by", "intrigued by"]
        passion_phrases = ["passionate about", "obsessed with", "really into"]
        
        for phrase in passion_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                item = " ".join(after.split()[:4]).rstrip(".,!?")
                if item and item not in existing_passions:
                    suggestions.append({
                        "action": "add",
                        "entity": "passion",
                        "data": {"passion": item},
                        "reason": f"Strong interest expressed: {item}",
                        "confidence": 0.75
                    })
                break
        
        for phrase in curiosity_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                item = " ".join(after.split()[:5]).rstrip(".,!?")
                if item and item.lower() not in existing_curiosities:
                    suggestions.append({
                        "action": "add",
                        "entity": "curiosity",
                        "data": {"curiosity": item},
                        "reason": f"Curiosity expressed: {item}",
                        "confidence": 0.7
                    })
                break
    
    # Goal triggers
    if "goal" in trigger_categories:
        goal_phrases = [
            ("want to", 0.6), ("wanna", 0.55), ("planning to", 0.65), ("plan to", 0.65),
            ("goal is", 0.75), ("my goal is", 0.8), ("trying to", 0.55), ("hoping to", 0.6),
            ("hope to", 0.6), ("aiming to", 0.65), ("aim to", 0.65), ("working towards", 0.7),
            ("dream of", 0.65), ("dreaming of", 0.65), ("dream is to", 0.7), ("aspire to", 0.7),
            ("would love to", 0.6), ("someday want to", 0.55), ("eventually want to", 0.55),
        ]
        for phrase, conf in goal_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                goal = " ".join(after.split()[:7]).rstrip(".,!?")
                if goal and len(goal) > 3:
                    # Check if it sounds like a career/learning goal vs casual wish
                    career_indicators = ["become", "be a", "learn", "master", "work", "build", "create", "start", "launch", "get into"]
                    is_career = any(ind in goal for ind in career_indicators)
                    if is_career:
                        suggestions.append({
                            "action": "add",
                            "entity": "career_aspiration",
                            "data": {"aspiration": goal},
                            "reason": f"Career/learning goal: {goal}",
                            "confidence": conf + 0.1
                        })
                    else:
                        suggestions.append({
                            "action": "add",
                            "entity": "career_aspiration",
                            "data": {"aspiration": goal},
                            "reason": f"Goal mentioned: {goal}",
                            "confidence": conf
                        })
                break
    
    # Achievement triggers - might indicate project or learning
    if "achievement" in trigger_categories:
        # Check for skills used in achievements
        for skill in detected_skills:
            if skill.lower() not in existing_domains:
                suggestions.append({
                    "action": "add",
                    "entity": "domain",
                    "data": {"name": skill, "level": "intermediate"},
                    "reason": f"Built something with: {skill}",
                    "confidence": 0.75
                })
        
        # Check for explicit project mentions
        achievement_phrases = ["built", "created", "made", "developed", "launched", "shipped", "released", "deployed"]
        for phrase in achievement_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                # Look for "a X" or just take the object
                words = after.split()
                if words and words[0] in ["a", "an", "the", "my"]:
                    project_name = " ".join(words[1:4]).rstrip(".,!?")
                else:
                    project_name = " ".join(words[:3]).rstrip(".,!?")
                
                # Filter out vague/generic project names
                if project_name and len(project_name) > 2:
                    is_vague = project_name.lower() in IGNORE_VAGUE_NAMES or any(
                        vague in project_name.lower() for vague in IGNORE_VAGUE_NAMES
                    )
                    
                    if not is_vague and project_name.lower() not in existing_projects:
                        suggestions.append({
                            "action": "add",
                            "entity": "project",
                            "data": {"name": project_name, "status": "completed", "description": f"Created/built project"},
                            "reason": f"Achievement: {phrase} {project_name}",
                            "confidence": 0.7
                        })
                break
        
        # Handle career achievements (accepted job, hired, promoted)
        career_phrases = [
            ("accepted", "after"),
            ("got accepted", "after"),
            ("hired for", "after"),
            ("hired at", "after"),
            ("got hired", "after"),
            ("landed a job", "after"),
            ("landed the job", "after"),
            ("got the job at", "after"),
            ("offered position", "after"),
            ("promoted to", "after"),
            ("got promoted", "after"),
        ]
        
        for phrase, direction in career_phrases:
            if phrase in message_lower:
                after = message_lower.split(phrase, 1)[1].strip()
                # Extract role and company
                words = after.split()
                
                # Common patterns: "graduate role at Deloitte", "as SWE at Google"
                role_words = []
                company = None
                
                for i, word in enumerate(words[:8]):
                    word_clean = word.rstrip(".,!?")
                    if word_clean in ["at", "with", "for"]:
                        company = " ".join(words[i+1:i+4]).rstrip(".,!?").title() if i+1 < len(words) else None
                        break
                    elif word_clean not in ["a", "an", "the", "as", "my"]:
                        role_words.append(word_clean)
                
                role = " ".join(role_words[:3]).title() if role_words else "New Position"
                
                if role or company:
                    work_entry = {"role": role} if role else {}
                    if company:
                        work_entry["company"] = company
                    work_entry["status"] = "active"
                    
                    suggestions.append({
                        "action": "add",
                        "entity": "work_experience",
                        "data": work_entry,
                        "reason": f"Career achievement: {phrase} {role}{' at ' + company if company else ''}",
                        "confidence": 0.90
                    })
                break
    
    # Wellness triggers - sleep and energy patterns
    if "wellness" in trigger_categories:
        # Sleep time detection
        sleep_patterns = [
            (r"(?:go to bed|sleep|bed(?:time)?)\s*(?:at|around|is)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)", "bedtime"),
            (r"(?:wake up|get up|rise)\s*(?:at|around)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)", "wakeup"),
            (r"(?:i )?(?:usually )?sleep\s*(?:at|around)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)", "bedtime"),
        ]
        
        for pattern, time_type in sleep_patterns:
            match = re.search(pattern, message_lower)
            if match:
                time_val = match.group(1).strip()
                # Normalize time format
                if ":" not in time_val:
                    time_val = f"{time_val}:00"
                
                day_type = "weekday"  # Default
                if any(w in message_lower for w in ["weekend", "saturday", "sunday"]):
                    day_type = "weekend"
                
                suggestions.append({
                    "action": "update",
                    "entity": "sleep",
                    "data": {"day_type": day_type, time_type: time_val},
                    "reason": f"Sleep pattern: {time_type} at {time_val}",
                    "confidence": 0.75
                })
                break
        
        # Energy peak detection
        energy_phrases = [
            "most productive", "energy peaks", "work best", "focus best",
            "peak productivity", "in the zone", "feel energized"
        ]
        for phrase in energy_phrases:
            if phrase in message_lower:
                # Extract when
                after = message_lower.split(phrase, 1)[1].strip()
                time_indicators = after.split()[:4]
                energy_time = " ".join(time_indicators).rstrip(".,!?")
                
                if energy_time and len(energy_time) > 2:
                    suggestions.append({
                        "action": "add",
                        "entity": "energy_peak",
                        "data": {"peak": energy_time},
                        "reason": f"Energy peak identified: {energy_time}",
                        "confidence": 0.7
                    })
                break
    
    # Enhanced suggestion processing pipeline
    if suggestions:
        # Resolve pronoun references
        entity_list = [
            {"type": "skill", "value": skill, "confidence": 0.8}
            for skill in detected_skills
        ]
        resolved_entities = resolve_pronoun_references(entity_list, message, conversation_context)
        
        # Cross-reference with existing persona data
        processed_suggestions = []
        for suggestion in suggestions:
            processed = cross_reference_persona(suggestion, persona)
            if processed.get('action') != 'skip':
                processed_suggestions.append(processed)
        suggestions = processed_suggestions
        
        # Deduplicate suggestions by entity
        suggestions = deduplicate_suggestions(suggestions)
        
        # Calculate evidence boost
        evidence_boost = calculate_evidence_boost(
            triggers=result["detected_triggers"],
            state_changes=state_changes,
            has_duration=has_duration,
            sentiment_positive=sentiment_positive
        )
        
        # Apply enhanced confidence formula
        sentiment_type = sentiment["statement_type"]
        trigger_strength = "explicit" if state_changes else ("strong" if len(result["detected_triggers"]) >= 2 else "moderate")
        
        for suggestion in suggestions:
            entity_exists = suggestion.get('action') == 'update'
            final_conf = calculate_final_confidence_v2(
                base_confidence=suggestion.get('raw_confidence', suggestion['confidence']),
                sentiment_type=sentiment_type,
                trigger_strength=trigger_strength,
                evidence_boost=evidence_boost,
                entity_exists=entity_exists,
                recurrence=0
            )
            
            suggestion["raw_confidence"] = suggestion.get('raw_confidence', suggestion['confidence'])
            suggestion["confidence"] = round(final_conf, 2)
            
            # Note: State change boost is already included in evidence_boost calculation
            # No need for additional boost here - that was causing over-inflation
        
        # Determine action based on entity-specific thresholds
        for suggestion in suggestions:
            is_removal = suggestion.get('action') == 'remove'
            action_type = get_action_from_confidence(
                suggestion['confidence'],
                suggestion['entity'],
                is_removal
            )
            suggestion["action_required"] = action_type
        
        # Update conversation context for pronoun resolution
        conversation_context.update_from_entities([
            {"type": s["entity"], "value": s["data"].get("name", "")}
            for s in suggestions if s["data"].get("name")
        ])
        
        result["suggestions"] = suggestions
        result["state_changes_detected"] = [s["type"] for s in state_changes]
        
        if suggestions:
            result["confidence"] = max(s["confidence"] for s in result["suggestions"])
            result["should_capture"] = result["confidence"] >= 0.4
            if not result["should_capture"]:
                result["ignore_reason"] = "Confidence below threshold after processing"
        else:
            result["confidence"] = 0.2
            result["ignore_reason"] = "All suggestions filtered out during processing"
            
    elif trigger_categories:
        # Triggers detected but no concrete suggestions
        sentiment_modifier = sentiment["confidence_modifier"]
        result["confidence"] = 0.3 * sentiment_modifier
        result["ignore_reason"] = "Triggers detected but no actionable entities found"
    else:
        result["confidence"] = 0.1
        result["ignore_reason"] = "No persona-relevant triggers detected"
    
    return result


def execute_modify(action: str, entity: str, data: dict) -> str:
    """Execute a single modify operation. Returns result message."""
    entity = entity.lower()
    
    # Normalize field names before processing
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
        
        # Support multiple field names for company lookup
        company = get_field(data, "company", "work", "employer", "organization", default="")
        if not company:
            return "❌ Work highlight requires 'company' to identify which work experience"
        
        idx, exp = find_in_array(work, company, "company")
        if idx == -1:
            return f"❌ Work experience at '{company}' not found"
        
        highlights = exp.setdefault("highlights", [])
        if action == "add":
            # Support single highlight or array of highlights
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
    
    elif entity == "coursework":
        profile = load_json("profile.json")
        coursework = profile.setdefault("education", {}).setdefault("coursework", [])
        
        if action == "add":
            if not data.get("name"):
                return "❌ Coursework requires 'name'"
            if any(c.get("name", "").lower() == data["name"].lower() for c in coursework):
                return f"ℹ️ Coursework '{data['name']}' already exists"
            coursework.append({"name": data["name"], "topics": data.get("topics", [])})
            save_json("profile.json", profile)
            return f"✅ Added coursework: {data['name']}"
        
        elif action == "remove":
            idx, _ = find_in_array(coursework, data.get("name", ""), "name")
            if idx == -1:
                return f"❌ Coursework '{data.get('name')}' not found"
            coursework.pop(idx)
            save_json("profile.json", profile)
            return f"✅ Removed coursework: {data['name']}"
    
    elif entity == "coursework_topic":
        profile = load_json("profile.json")
        coursework = profile.get("education", {}).get("coursework", [])
        idx, course = find_in_array(coursework, data.get("course_name", ""), "name")
        if idx == -1:
            return f"❌ Coursework '{data.get('course_name')}' not found"
        
        topics = course.setdefault("topics", [])
        if action == "add":
            topics.append(data.get("topic", ""))
            save_json("profile.json", profile)
            return f"✅ Added topic to {data['course_name']}"
        elif action == "remove":
            if data.get("topic") in topics:
                topics.remove(data["topic"])
                save_json("profile.json", profile)
                return f"✅ Removed topic from {data['course_name']}"
            return f"❌ Topic not found"
    
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
    
    # === LIFESTYLE-BASED ENTITIES ===
    elif entity == "hobby":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.setdefault("hobbies", [])
        # Flexible field extraction - LLMs might call it "hobby", "name", "activity", etc.
        name = get_field(data, "name", "hobby", "hobby_name", "title", "activity")
        skill_level = get_field(data, "skill_level", "level", "proficiency", default="enthusiast")
        status = get_field(data, "status", "state", "is_active", default="active")
        # Normalize status values
        if status in ["inactive", "stopped", "paused", "not_active", "false", False]:
            status = "inactive"
        else:
            status = "active"
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Hobby requires a name (try 'name', 'hobby', or 'activity' field)"
            if any(h.get("name", "").lower() == name.lower() for h in hobbies):
                return f"ℹ️ Hobby '{name}' already exists"
            hobbies.append({
                "name": name,
                "skill_level": skill_level,
                "status": status,
                "notes": notes,
                "specifics": data.get("specifics", []),
                "references": []
            })
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added hobby: {name} (status: {status})"
        
        elif action == "update":
            idx, hobby = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            # Update skill_level if explicitly provided
            if data.get("skill_level") or data.get("level") or data.get("proficiency"):
                hobby["skill_level"] = skill_level
            # Update status if explicitly provided
            if data.get("status") or data.get("state") or data.get("is_active") is not None:
                hobby["status"] = status
            if notes:
                hobby["notes"] = notes
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("lifestyle.json", lifestyle)
            status_info = f" (status: {hobby.get('status', 'active')})" if hobby.get("status") else ""
            return f"✅ Updated hobby: {name}{status_info}"
        
        elif action == "remove":
            idx, _ = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            hobbies.pop(idx)
            save_json("lifestyle.json", lifestyle)
            return f"✅ Removed hobby: {name}"
    
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
            for field in ["url", "notes", "name"]:
                if data.get(f"new_{field}" if field == "name" else field):
                    ref[field] = data.get(f"new_{field}" if field == "name" else field)
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
            specifics.append(specific_val or "")
            save_json("lifestyle.json", lifestyle)
            return f"✅ Added specific to {hobby_name}"
        elif action == "remove":
            if specific_val in specifics:
                specifics.remove(specific_val)
                save_json("lifestyle.json", lifestyle)
                return f"✅ Removed specific from {hobby_name}"
            return f"❌ Specific not found"
    
    # === KNOWLEDGE-BASED ENTITIES ===
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
                "name": name,
                "level": level,
                "notes": notes,
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
    
    # === PREFERENCES-BASED ENTITIES ===
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
    
    elif entity == "dislike":
        preferences = load_json("preferences.json")
        dislikes = preferences.setdefault("dislikes", [])
        item = get_field(data, "dislike", "item", "thing", "name", "what", default="")
        
        if action == "add":
            if not item:
                return "❌ Dislike requires 'dislike' or 'item'"
            # Check if already exists (case-insensitive)
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
        else:
            return f"❌ communication_default only supports 'update' action"
    
    elif entity == "mood_override":
        preferences = load_json("preferences.json")
        comm = preferences.setdefault("communication", {})
        overrides = comm.setdefault("mood_overrides", [])
        mood = get_field(data, "mood", "feeling", "state", "when", default="")
        
        if action == "add":
            if not mood:
                return "❌ mood_override requires 'mood' (e.g., 'stressed', 'tired', 'excited')"
            
            # Check if mood already exists
            existing = next((o for o in overrides if o.get("mood", "").lower() == mood.lower()), None)
            if existing:
                # Update existing override
                if data.get("tone"):
                    existing["tone"] = data["tone"]
                if data.get("detail_level"):
                    existing["detail_level"] = data["detail_level"]
                save_json("preferences.json", preferences)
                return f"✅ Updated mood override for '{mood}'"
            
            # Add new override
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
                "name": name,
                "description": description,
                "status": status,
                "tags": data.get("tags", []),
                "references": data.get("references", []),
                "highlights": data.get("highlights", []),
                "notes": notes,
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
            refs.append({
                "name": ref_name or "",
                "url": ref_url,
                "notes": ref_notes
            })
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

        # Support multiple field names for project lookup
        project_name = get_field(data, "project_name", "project", "for_project", "parent")
        if not project_name:
            return "❌ Project highlight requires 'project_name' to identify which project"

        idx, project = find_in_array(project_list, project_name, "name")
        if idx == -1:
            return f"❌ Project '{project_name}' not found"

        highlights = project.setdefault("highlights", [])
        if action == "add":
            # Support single highlight or array of highlights
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
            learning.append({
                "topic": topic,
                "context": context,
                "priority": priority
            })
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
        
        # Helper to get the idea text from an item (handles both string and dict formats)
        def get_idea_text(t):
            return t.get("idea", "") if isinstance(t, dict) else t
        
        if action == "add":
            if not item:
                return "❌ Top of mind requires 'item', 'idea', or 'topic'"
            # Check for existing (compare idea text)
            existing = next((t for t in tom if get_idea_text(t).lower() == item.lower()), None)
            if existing:
                return f"ℹ️ '{item}' already top of mind"
            # Store as dict with idea and optional note
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
    
    # === LIFESTYLE EXTRAS ===
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
    
    # === KNOWLEDGE EXTRAS ===
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
                "name": name,
                "level": level,
                "notes": notes,
                "references": data.get("references", [])
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
            refs.append({
                "name": ref_name or "",
                "url": ref_url,
                "notes": ref_notes
            })
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
    
    elif entity == "mental_tab":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.setdefault("mental_tabs", [])
        # Support both 'title' (frontend format) and 'topic' (original format)
        topic = get_field(data, "title", "topic", "name", "mental_tab", "subject")
        context = get_field(data, "context", "content", "description", "details", default="")
        status = get_field(data, "status", "state", default="open")
        
        if action == "add":
            if not topic:
                return "❌ Mental tab requires 'title' or 'topic'"
            # Check both title and topic fields in existing tabs
            if any((t.get("title", "") or t.get("topic", "")).lower() == topic.lower() for t in tabs):
                return f"ℹ️ Mental tab '{topic}' already exists"
            tabs.append({
                "title": topic,  # Use 'title' to match frontend format
                "content": context,
                "tags": data.get("tags", []),
                "status": status,
                "references": data.get("references", []),
                "created_at": datetime.now().isoformat() + "Z"
            })
            save_json("knowledge.json", knowledge)
            return f"✅ Added mental tab: {topic}"
        
        elif action == "update":
            # Try to find by 'title' first (frontend format), then 'topic'
            idx, tab = find_in_array(tabs, topic or "", "title")
            if idx == -1:
                idx, tab = find_in_array(tabs, topic or "", "topic")
            if idx == -1:
                return f"❌ Mental tab '{topic}' not found"
            if context:
                tab["content"] = context  # Use 'content' to match frontend format
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
    
    elif entity == "mental_tab_reference":
        knowledge = load_json("knowledge.json")
        tabs = knowledge.get("mental_tabs", [])
        # Support both 'title' (frontend) and 'topic' for parent identification
        topic = get_field(data, "title", "topic", "mental_tab", "for_tab", "parent")
        
        # Try to find by 'title' first, then 'topic'
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
            refs.append({
                "name": ref_name or "",
                "url": ref_url,
                "notes": ref_notes
            })
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
    
    # === EDUCATION (array-based) ===
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
    
    elif entity == "education_highlight":
        profile = load_json("profile.json")
        education = profile.get("education", [])
        idx, edu = find_in_array(education, data.get("institution", ""), "institution")
        if idx == -1:
            return f"❌ Education at '{data.get('institution')}' not found"
        
        highlights = edu.setdefault("highlights", [])
        if action == "add":
            highlights.append(data.get("highlight", ""))
            save_json("profile.json", profile)
            return f"✅ Added highlight to {data['institution']}"
        elif action == "remove":
            if data.get("highlight") in highlights:
                highlights.remove(data["highlight"])
                save_json("profile.json", profile)
                return f"✅ Removed highlight"
            return f"❌ Highlight not found"
    
    # === LEARNING LOG ===
    elif entity == "learning_entry":
        log = load_json("learning_log.json")
        if "error" in log:
            log = {"entries": []}
        entries = log.setdefault("entries", [])
        
        if action == "add":
            if not data.get("topic") or not data.get("details"):
                return "❌ Learning entry requires 'topic' and 'details'"
            entries.append({
                "topic": data["topic"],
                "details": data["details"],
                "source": data.get("source", "conversation"),
                "tags": data.get("tags", []),
                "timestamp": datetime.now().isoformat()
            })
            save_json("learning_log.json", log)
            return f"✅ Logged learning: {data['topic']}"
        
        elif action == "remove":
            # Find by topic (most recent first)
            topic = data.get("topic", "")
            for i in range(len(entries) - 1, -1, -1):
                if entries[i].get("topic", "").lower() == topic.lower():
                    entries.pop(i)
                    save_json("learning_log.json", log)
                    return f"✅ Removed learning entry: {topic}"
            return f"❌ Learning entry not found"
    
    return f"❌ Unknown entity type: {entity}"

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle tool calls"""
    logger.info(f"call_tool: {name}")
    try:
        # SMART CONTEXT (recommended first call)
        if name == "get_context":
            scope = arguments.get("scope", "minimal")
            topic = arguments.get("topic")
            include_inactive = arguments.get("include_inactive", False)
            result = get_scoped_context(scope, topic, include_inactive)
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        # READ operations (individual files)
        elif name == "get_persona":
            return [TextContent(type="text", text=json.dumps(get_all_persona_data(), indent=2))]
        
        elif name == "get_profile":
            return [TextContent(type="text", text=json.dumps(load_json("profile.json"), indent=2))]
        
        elif name == "get_lifestyle":
            return [TextContent(type="text", text=json.dumps(load_json("lifestyle.json"), indent=2))]
        
        elif name == "get_knowledge":
            return [TextContent(type="text", text=json.dumps(load_json("knowledge.json"), indent=2))]
        
        elif name == "get_preferences":
            return [TextContent(type="text", text=json.dumps(load_json("preferences.json"), indent=2))]
        
        elif name == "get_projects":
            return [TextContent(type="text", text=json.dumps(load_json("projects.json"), indent=2))]
        
        elif name == "get_learning_log":
            return [TextContent(type="text", text=json.dumps(load_json("learning_log.json"), indent=2))]
        
        # WRITE operations
        elif name == "persona_update":
            path = arguments.get("path", "")
            value = arguments.get("value", "")
            
            # Parse the path to determine which file to update
            parts = path.split(".")
            if not parts:
                return [TextContent(type="text", text="❌ Invalid path")]
            
            root = parts[0]
            if root not in FILE_MAP:
                return [TextContent(type="text", text=f"❌ Unknown root: {root}. Use: profile, lifestyle, knowledge, preferences, projects")]
            
            data = load_json(FILE_MAP[root])
            remaining_path = ".".join(parts[1:])
            
            if remaining_path:
                if set_nested_value(data, remaining_path, value):
                    if save_json(FILE_MAP[root], data):
                        return [TextContent(type="text", text=f"✅ Updated {path} = {value}")]
                return [TextContent(type="text", text=f"❌ Failed to update {path}")]
            else:
                return [TextContent(type="text", text=f"❌ Path too short, need field to update")]
        
        elif name == "persona_modify":
            action = arguments.get("action", "")
            entity = arguments.get("entity", "")
            data = arguments.get("data", {})
            
            result = execute_modify(action, entity, data)
            return [TextContent(type="text", text=result)]
        
        elif name == "persona_batch":
            # Handle multiple input formats LLMs might use
            operations = arguments.get("operations", [])
            
            # Fallback: if operations is empty, check if arguments itself is a list
            if not operations and isinstance(arguments, list):
                operations = arguments
            
            # Fallback: if single operation passed without array wrapper
            if not operations and "action" in arguments and "entity" in arguments:
                operations = [arguments]
            
            if not operations:
                return [TextContent(type="text", text="❌ No operations provided. Format: {\"operations\": [{\"action\": \"add\", \"entity\": \"...\", \"data\": {...}}]}")]
            
            results = []
            for i, op in enumerate(operations):
                action = op.get("action", "")
                entity = op.get("entity", "")
                data = op.get("data", {})
                result = execute_modify(action, entity, data)
                results.append(f"{i+1}. {result}")
            
            return [TextContent(type="text", text="\n".join(results))]
        
        # SMART CONTEXT CAPTURE
        elif name == "suggest_persona_update":
            message = arguments.get("message", "")
            context = arguments.get("context", "")
            
            if not message:
                return [TextContent(type="text", text=json.dumps({
                    "error": "No message provided",
                    "should_capture": False,
                    "confidence": 0.0,
                    "suggestions": []
                }, indent=2))]
            
            analysis = analyze_message_for_capture(message, context)
            
            # Generate UX grouping for better batched confirmations (Fix #12)
            ux_grouping = consolidate_suggestions_for_ux(analysis.get("suggestions", []))
            
            # Determine overall action based on UX grouping
            if ux_grouping["auto_apply"]:
                overall_action = "auto_apply"
            elif ux_grouping["batch_confirm"]:
                overall_action = "batch_confirm"
            elif ux_grouping["individual_confirm"]:
                overall_action = "ask_user"
            else:
                overall_action = "ignore"
            
            # Format response for LLM consumption
            response = {
                "should_capture": analysis["should_capture"],
                "confidence": analysis["confidence"],
                "confidence_level": (
                    "high" if analysis["confidence"] >= 0.8 else
                    "medium" if analysis["confidence"] >= 0.5 else
                    "low"
                ),
                "suggestions": analysis["suggestions"],
                "ux_grouping": ux_grouping,
                "detected_triggers": analysis["detected_triggers"],
                "detected_entities": analysis["detected_entities"],
                "state_changes": analysis.get("state_changes_detected", []),
                "action_required": overall_action,
                "ignore_reason": analysis.get("ignore_reason"),
                "sentiment": analysis.get("sentiment", {})
            }
            
            # Add helpful instructions for the LLM based on UX grouping
            if overall_action == "auto_apply":
                auto_count = len(ux_grouping["auto_apply"])
                response["instruction"] = (
                    f"HIGH confidence ({auto_count} update{'s' if auto_count > 1 else ''}). "
                    f"Apply using persona_modify, then mention: '✓ Updated your persona with...'"
                )
            elif overall_action == "batch_confirm":
                batch_count = len(ux_grouping["batch_confirm"])
                response["instruction"] = (
                    f"MEDIUM confidence ({batch_count} updates). Ask user ONCE for all: "
                    f"'I noticed a few things to add to your persona: [list]. Want me to add these?'"
                )
            elif overall_action == "ask_user":
                response["instruction"] = (
                    "MEDIUM confidence. Ask user for confirmation: "
                    "'Want me to add X to your persona?'"
                )
            else:
                response["instruction"] = (
                    "LOW confidence. Respond normally without mentioning persona updates."
                )
            
            return [TextContent(type="text", text=json.dumps(response, indent=2))]
        
        else:
            return [TextContent(type="text", text=f"❌ Unknown tool: {name}")]
    
    except Exception as e:
        logger.error(f"Tool error: {str(e)}", exc_info=True)
        return [TextContent(type="text", text=f"❌ Error: {str(e)}")]

async def main():
    """Main entry point using stdio transport"""
    logger.info("Starting MCP server v2")
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal: {str(e)}", exc_info=True)
        sys.exit(1)
