#!/usr/bin/env python3
"""
MCP Server for Persona Data (v2 - Consolidated)
Streamlined tools for reading and modifying persona data.
"""

import json
import sys
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

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
    "interests": "interests.json", 
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
    """List available MCP tools - consolidated to 9 tools"""
    return [
        # === READ TOOLS (7) ===
        Tool(
            name="get_persona",
            description="""Get ALL persona data at once. Use for initial context gathering.
Returns: profile, interests, knowledge, preferences, projects, learning_log.

TIP: Call this first to understand what data exists before making updates.
Look at the structure to determine where new information should go.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_profile",
            description="""Get profile/identity data:
├── name, bio, location
├── contact: emails[], links[]
├── languages_spoken[]: {name, fluency}
├── education[]: degrees with highlights[]
├── work_experience[]: jobs with highlights[]  
└── career_aspirations[]: goal strings

Use before: adding emails, links, languages, education, work experience.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_interests",
            description="""Get interests/personality data:
├── hobbies[]: 
│   ├── name, skill_level, notes
│   ├── specifics[]: sub-focuses (e.g., "street photography")
│   └── references[]: gear, tutorials, resources
├── passions[]: deep interests (strings)
├── curiosities[]: things exploring (strings)
├── personality_traits[]: characteristics (strings)
└── values[]: core beliefs (strings)

⚡ BEFORE UPDATING: Check if hobby exists, then decide:
- Update hobby itself → skill_level, notes
- Add sub-category → hobby_specific
- Add gear/resource → hobby_reference""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_knowledge",
            description="""Get knowledge/expertise data:
├── domains[]: skills/technologies
│   ├── name, level (learning/intermediate/advanced), notes
│   └── references[]: docs, courses, resources
└── mental_tabs[]: topics being tracked/explored
    ├── title: topic name (e.g., "Matcha Places")
    ├── content: general notes about the topic
    ├── tags[], status (open/exploring/resolved)
    └── references[]: ⚠️ THE ACTUAL LISTS LIVE HERE
        ├── name: section identifier (e.g., "good spots in newcastle")
        └── notes: the actual items/places/resources

⚡ MENTAL TAB ROUTING:
When user says "add X to my [topic] list", find the mental_tab by title,
then find the right reference by name, and UPDATE the notes field.
Don't add to content - that's for general topic notes only.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_preferences",
            description="""Get user preferences for AI interaction:
├── code_style: languages, frameworks, tools, conventions
├── communication: tone, detail_level, locale, avoid[], preferences[]
├── learning_style: preferred[], avoid[]
├── response_format: code_blocks, bullet_points, etc.
├── work_preferences: timezone, productivity_time, approach
└── dislikes[]: things the user specifically does NOT like (strings)

⚡ ROUTING:
• "I don't like X" → ADD dislike {dislike: "X"}
• "Actually I'm okay with X now" → REMOVE dislike {dislike: "X"}
• Use dislikes to understand what to AVOID in responses/recommendations.""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_projects",
            description="""Get projects/focus data:
├── projects[]: 
│   ├── name, description, status (planning/active/paused/completed)
│   ├── notes: project thoughts
│   ├── tags[]: technologies/categories
│   └── references[]: related links, docs
├── current_learning[]: 
│   └── {topic, context, priority (high/medium/low)}
└── top_of_mind[]: current focus items (strings)

⚡ ROUTING:
- Project update → UPDATE project {name, status/notes}
- Add technology → ADD project_tag {project_name, tag}
- Add resource link → ADD project_reference {project_name, ref_name, url}
- Learning something → ADD current_learning OR ADD domain
- Current focus → ADD/REMOVE top_of_mind""",
            inputSchema={"type": "object", "properties": {}, "required": []}
        ),
        Tool(
            name="get_learning_log",
            description="""Get timestamped learning entries from conversations:
entries[]: {timestamp, topic, details, source, tags[]}

Add new learnings with: ADD learning_entry {topic, details, source, tags[]}
This creates a searchable knowledge base of things learned over time.""",
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
- interests.hobbies.Gaming.notes → "Playing more lately"
- knowledge.domains.Python.level → "advanced"
- projects.projects.Solterra.status → "completed"

For arrays, use item name as path segment.
For complex operations (add/remove items), use persona_modify instead.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Dot-notation path to the field (e.g., 'profile.bio', 'interests.hobbies.Gaming.skill_level')"
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

╔══════════════════════════════════════════════════════════════════╗
║                    DECISION GUIDE: WHERE DOES IT GO?             ║
╚══════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PROFILE DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
profile.json structure:
├── name, bio, location (use persona_update for these)
├── contact:
│   ├── emails[]: {address, purpose}
│   └── links[]: {url, label}
├── languages_spoken[]: {name, fluency}
├── education[]: {institution, degree_level, field_of_study, years, highlights[]}
├── work_experience[]: {role, company, type, period, highlights[]}
└── career_aspirations[]: strings

⚡ ROUTING:
• "Add my work email" → ADD email {address, purpose: "work"}
• "Add LinkedIn" → ADD link {url, label: "LinkedIn"}
• "I speak French now" → ADD language {name: "French", fluency: "basic"}
• "Add job experience" → ADD work_experience {role, company, type, period}
• "Add achievement at Honda" → ADD work_highlight {company: "Honda", highlight: "..."}
• "I want to become X" → ADD career_aspiration {aspiration: "..."}
• "Add my degree" → ADD education {institution, degree_level, field_of_study, ...}
• "Add coursework topic" → ADD education_highlight {institution, highlight: "..."}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 INTERESTS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interests.json structure:
├── hobbies[]:
│   ├── name, skill_level, notes
│   ├── specifics[]: sub-categories (strings)
│   └── references[]: {name, url, notes} ← gear, tutorials, resources
├── passions[]: strings (deep interests)
├── curiosities[]: strings (things exploring)
├── personality_traits[]: strings
└── values[]: strings (core beliefs)

⚡ ROUTING:
• "I picked up Photography" → ADD hobby {name: "Photography"}
• "I'm now intermediate at X" → UPDATE hobby {name: "X", skill_level: "intermediate"}
• "I focus on street photography" → ADD hobby_specific {hobby_name, specific: "street"}
• "Here's my camera gear" → ADD hobby_reference {hobby_name, ref_name: "gear", notes: "..."}
• "Update my gear list" → UPDATE hobby_reference {hobby_name, ref_name: "gear", notes: "..."}
• "I'm passionate about X" → ADD passion {passion: "X"}
• "I'm curious about Y" → ADD curiosity {curiosity: "Y"}
• "I value honesty" → ADD value {value: "honesty"}
• "I'm introverted" → ADD personality_trait {trait: "introverted"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 KNOWLEDGE DATA  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
knowledge.json structure:
├── domains[]:
│   ├── name, level (learning/intermediate/advanced), notes
│   └── references[]: {name, url, notes} ← docs, courses, resources
└── mental_tabs[]:
    ├── title: topic name (e.g., "Matcha Places")
    ├── content: general notes about the topic
    ├── tags[], status (open/exploring/resolved)
    └── references[]: {name, url, notes} ← THE ACTUAL LISTS LIVE HERE
        └── notes field = where specific items go!

⚡ ROUTING FOR DOMAINS:
• "I'm learning Rust" → ADD domain {name: "Rust", level: "learning"}
• "I'm now advanced in Python" → UPDATE domain {name: "Python", level: "advanced"}
• "Good Python resource" → ADD domain_reference {domain_name, ref_name, url, notes}
• "Update my Python resources" → UPDATE domain_reference notes

⚡ ROUTING FOR MENTAL TABS (important!):
• "Add matcha spots: A, B, C" → UPDATE mental_tab_reference notes (append to list)
• "New section for London spots" → ADD mental_tab_reference {title, ref_name: "london spots", notes}
• "Rename topic to Coffee" → UPDATE mental_tab {title: "old", new_title: "Coffee"}
• "Mark this as resolved" → UPDATE mental_tab {title, status: "resolved"}
• "General thoughts on matcha" → UPDATE mental_tab content

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 PROJECTS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
projects.json structure:
├── projects[]:
│   ├── name, description, status (planning/active/paused/completed), notes
│   ├── tags[]: technologies/categories
│   └── references[]: {name, url, notes} ← related links, docs
├── current_learning[]: {topic, context, priority (high/medium/low)}
└── top_of_mind[]: strings (current focus items)

⚡ ROUTING:
• "New project Solterra" → ADD project {name, description}
• "Solterra is now active" → UPDATE project {name: "Solterra", status: "active"}
• "Add React tag to Solterra" → ADD project_tag {project_name, tag: "React"}
• "Solterra design doc" → ADD project_reference {project_name, ref_name, url}
• "I'm learning Docker" → ADD current_learning {topic, context, priority}
• "Focus on MCP server" → ADD top_of_mind {item: "MCP server"}
• "Done with that task" → REMOVE top_of_mind {item: "..."}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 LEARNING LOG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
learning_log.json: entries[] with timestamped learnings

⚡ ROUTING:
• "I just learned that X" → ADD learning_entry {topic, details, source, tags[]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ PREFERENCES DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
preferences.json structure:
├── code_style, communication, learning_style, response_format, work_preferences
└── dislikes[]: things the user specifically does NOT like (strings)

⚡ ROUTING:
• "I don't like X" → ADD dislike {dislike: "X"}
• "I hate when Y happens" → ADD dislike {dislike: "Y"}
• "Actually X is fine now" → REMOVE dislike {dislike: "X"}
• Use dislikes to AVOID recommending or doing these things!

╔══════════════════════════════════════════════════════════════════╗
║                         ENTITY REFERENCE                          ║
╚══════════════════════════════════════════════════════════════════╝

PROFILE: email, link, language, work_experience, work_highlight, 
         education, education_highlight, career_aspiration

INTERESTS: hobby, hobby_reference, hobby_specific, 
           passion, curiosity, personality_trait, value

KNOWLEDGE: domain, domain_reference, mental_tab, mental_tab_reference

PROJECTS: project, project_reference, project_tag, 
          current_learning, top_of_mind

PREFERENCES: dislike, preference

LEARNING: learning_entry

╔══════════════════════════════════════════════════════════════════╗
║                      FIELD NAME FLEXIBILITY                       ║
╚══════════════════════════════════════════════════════════════════╝
All accept multiple naming conventions:
• name/title/hobby/activity/topic → identifier field
• ref_name/name/reference_name → reference identifier  
• notes/description/details → content field
• address/email/email_address → email identifier
• dislike/item/thing/what → dislike identifier""",
            inputSchema={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "update", "remove"],
                        "description": "The action to perform"
                    },
                    "entity": {
                        "type": "string",
                        "description": "Entity type: hobby, mental_tab_reference, domain, project, etc."
                    },
                    "data": {
                        "type": "object",
                        "description": "Entity data. For nested items (references, specifics), include parent identifier."
                    }
                },
                "required": ["action", "entity", "data"]
            }
        ),
        Tool(
            name="persona_batch",
            description="""Perform multiple persona modifications in one call.

COMMON PATTERNS:
1. Adding items to an existing list in a mental tab:
   {"action": "update", "entity": "mental_tab_reference", 
    "data": {"title": "Matcha Places", "ref_name": "good places in newcastle", 
             "notes": "Bamboo Tea, Gong Cha, Hey Tea, NEW PLACE"}}

2. Adding a new hobby with references:
   [{"action": "add", "entity": "hobby", "data": {"name": "Cycling"}},
    {"action": "add", "entity": "hobby_reference", 
     "data": {"hobby_name": "Cycling", "ref_name": "gear", "notes": "Trek bike, helmet"}}]

3. Updating project status and adding a note:
   [{"action": "update", "entity": "project", 
     "data": {"name": "Solterra", "status": "active", "notes": "Launched MVP!"}}]

Each operation: {action, entity, data}. See persona_modify for full decision guide.""",
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
                        "description": "Array of modification operations"
                    }
                },
                "required": ["operations"]
            }
        )
    ]

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
        idx, exp = find_in_array(work, data.get("company", ""), "company")
        if idx == -1:
            return f"❌ Work experience at '{data.get('company')}' not found"
        
        highlights = exp.setdefault("highlights", [])
        if action == "add":
            highlights.append(data.get("highlight", ""))
            save_json("profile.json", profile)
            return f"✅ Added highlight to {data['company']}"
        elif action == "remove":
            if data.get("highlight") in highlights:
                highlights.remove(data["highlight"])
                save_json("profile.json", profile)
                return f"✅ Removed highlight from {data['company']}"
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
    
    # === INTERESTS-BASED ENTITIES ===
    elif entity == "hobby":
        interests = load_json("interests.json")
        hobbies = interests.setdefault("hobbies", [])
        # Flexible field extraction - LLMs might call it "hobby", "name", "activity", etc.
        name = get_field(data, "name", "hobby", "hobby_name", "title", "activity")
        skill_level = get_field(data, "skill_level", "level", "proficiency", default="enthusiast")
        notes = get_field(data, "notes", "description", "details", default="")
        
        if action == "add":
            if not name:
                return "❌ Hobby requires a name (try 'name', 'hobby', or 'activity' field)"
            if any(h.get("name", "").lower() == name.lower() for h in hobbies):
                return f"ℹ️ Hobby '{name}' already exists"
            hobbies.append({
                "name": name,
                "skill_level": skill_level,
                "notes": notes,
                "specifics": data.get("specifics", []),
                "references": []
            })
            save_json("interests.json", interests)
            return f"✅ Added hobby: {name}"
        
        elif action == "update":
            idx, hobby = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            if skill_level != "enthusiast" or data.get("skill_level"):  # Only update if explicitly provided
                hobby["skill_level"] = skill_level
            if notes:
                hobby["notes"] = notes
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            save_json("interests.json", interests)
            return f"✅ Updated hobby: {name}"
        
        elif action == "remove":
            idx, _ = find_in_array(hobbies, name or "", "name")
            if idx == -1:
                return f"❌ Hobby '{name}' not found"
            hobbies.pop(idx)
            save_json("interests.json", interests)
            return f"✅ Removed hobby: {name}"
    
    elif entity == "hobby_reference":
        interests = load_json("interests.json")
        hobbies = interests.get("hobbies", [])
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
            save_json("interests.json", interests)
            return f"✅ Added reference to {hobby_name}"
        
        elif action == "update":
            ref_idx, ref = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            for field in ["url", "notes", "name"]:
                if data.get(f"new_{field}" if field == "name" else field):
                    ref[field] = data.get(f"new_{field}" if field == "name" else field)
            save_json("interests.json", interests)
            return f"✅ Updated reference in {hobby_name}"
        
        elif action == "remove":
            ref_idx, _ = find_in_array(refs, ref_name or "", "name")
            if ref_idx == -1:
                return f"❌ Reference '{ref_name}' not found"
            refs.pop(ref_idx)
            save_json("interests.json", interests)
            return f"✅ Removed reference from {hobby_name}"
    
    elif entity == "hobby_specific":
        interests = load_json("interests.json")
        hobbies = interests.get("hobbies", [])
        hobby_name = get_field(data, "hobby_name", "hobby", "parent", "for_hobby")
        idx, hobby = find_in_array(hobbies, hobby_name or "", "name")
        if idx == -1:
            return f"❌ Hobby '{hobby_name}' not found"
        
        specifics = hobby.setdefault("specifics", [])
        specific_val = get_field(data, "specific", "value", "item", "detail")
        if action == "add":
            specifics.append(specific_val or "")
            save_json("interests.json", interests)
            return f"✅ Added specific to {hobby_name}"
        elif action == "remove":
            if specific_val in specifics:
                specifics.remove(specific_val)
                save_json("interests.json", interests)
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
                "notes": notes,
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            save_json("projects.json", projects)
            return f"✅ Added project: {name}"
        
        elif action == "update":
            idx, project = find_in_array(project_list, name or "", "name")
            if idx == -1:
                return f"❌ Project '{name}' not found"
            for field in ["description", "status", "url", "tags", "references", "notes", "challenges", "goals"]:
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
        item = get_field(data, "item", "topic", "thought", "subject", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Top of mind requires 'item' or 'topic'"
            if item in tom:
                return f"ℹ️ '{item}' already top of mind"
            tom.append(item)
            save_json("projects.json", projects)
            return f"✅ Added to top of mind: {item}"
        
        elif action == "remove":
            found = next((t for t in tom if t.lower() == item.lower()), None)
            if not found:
                return f"❌ '{item}' not in top of mind"
            tom.remove(found)
            save_json("projects.json", projects)
            return f"✅ Removed from top of mind: {item}"
    
    # === INTERESTS EXTRAS ===
    elif entity == "passion":
        interests = load_json("interests.json")
        passions = interests.setdefault("passions", [])
        item = get_field(data, "passion", "name", "interest", "topic", default="")
        
        if action == "add":
            if not item:
                return "❌ Passion requires 'passion' or 'name'"
            if item in passions:
                return f"ℹ️ '{item}' already in passions"
            passions.append(item)
            save_json("interests.json", interests)
            return f"✅ Added passion: {item}"
        elif action == "remove":
            found = next((p for p in passions if p.lower() == item.lower()), None)
            if not found:
                return f"❌ Passion not found"
            passions.remove(found)
            save_json("interests.json", interests)
            return f"✅ Removed passion: {item}"
    
    elif entity == "curiosity":
        interests = load_json("interests.json")
        curiosities = interests.setdefault("curiosities", [])
        item = get_field(data, "curiosity", "topic", "subject", "interest", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Curiosity requires 'curiosity' or 'topic'"
            if item in curiosities:
                return f"ℹ️ '{item}' already in curiosities"
            curiosities.append(item)
            save_json("interests.json", interests)
            return f"✅ Added curiosity: {item}"
        elif action == "remove":
            found = next((c for c in curiosities if c.lower() == item.lower()), None)
            if not found:
                return f"❌ Curiosity not found"
            curiosities.remove(found)
            save_json("interests.json", interests)
            return f"✅ Removed curiosity: {item}"
    
    elif entity == "personality_trait":
        interests = load_json("interests.json")
        traits = interests.setdefault("personality_traits", [])
        item = get_field(data, "trait", "personality_trait", "characteristic", "quality", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Personality trait requires 'trait' or 'name'"
            if item in traits:
                return f"ℹ️ '{item}' already in traits"
            traits.append(item)
            save_json("interests.json", interests)
            return f"✅ Added trait: {item}"
        elif action == "remove":
            found = next((t for t in traits if t.lower() == item.lower()), None)
            if not found:
                return f"❌ Trait not found"
            traits.remove(found)
            save_json("interests.json", interests)
            return f"✅ Removed trait: {item}"
    
    elif entity == "value":
        interests = load_json("interests.json")
        values = interests.setdefault("values", [])
        item = get_field(data, "value", "core_value", "belief", "principle", "name", default="")
        
        if action == "add":
            if not item:
                return "❌ Value requires 'value' or 'name'"
            if item in values:
                return f"ℹ️ '{item}' already in values"
            values.append(item)
            save_json("interests.json", interests)
            return f"✅ Added value: {item}"
        elif action == "remove":
            found = next((v for v in values if v.lower() == item.lower()), None)
            if not found:
                return f"❌ Value not found"
            values.remove(found)
            save_json("interests.json", interests)
            return f"✅ Removed value: {item}"
    
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
        # READ operations
        if name == "get_persona":
            return [TextContent(type="text", text=json.dumps(get_all_persona_data(), indent=2))]
        
        elif name == "get_profile":
            return [TextContent(type="text", text=json.dumps(load_json("profile.json"), indent=2))]
        
        elif name == "get_interests":
            return [TextContent(type="text", text=json.dumps(load_json("interests.json"), indent=2))]
        
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
                return [TextContent(type="text", text=f"❌ Unknown root: {root}. Use: profile, interests, knowledge, preferences, projects")]
            
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
            operations = arguments.get("operations", [])
            results = []
            
            for i, op in enumerate(operations):
                action = op.get("action", "")
                entity = op.get("entity", "")
                data = op.get("data", {})
                result = execute_modify(action, entity, data)
                results.append(f"{i+1}. {result}")
            
            return [TextContent(type="text", text="\n".join(results))]
        
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
