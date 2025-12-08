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
Returns: profile, lifestyle, knowledge, preferences, projects, learning_log.

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
            name="get_lifestyle",
            description="""Get lifestyle/personality data:
├── hobbies[]: 
│   ├── name, skill_level, notes
│   ├── specifics[]: sub-focuses (e.g., "street photography")
│   └── references[]: gear, tutorials, resources
├── passions[]: deep passions (strings)
├── curiosities[]: things exploring (strings)
├── personality_traits[]: characteristics (strings)
├── values[]: core beliefs (strings)
└── wellness:
    ├── sleep: {weekday: {bedtime, wakeup}, weekend: {bedtime, wakeup}}
    └── energy_peaks[]: times when most productive (strings)

⚡ BEFORE UPDATING: Check if hobby exists, then decide:
- Update hobby itself → skill_level, notes
- Add sub-category → hobby_specific
- Add gear/resource → hobby_reference

⚡ WELLNESS ROUTING:
- "I sleep at 11pm" → UPDATE sleep {day_type: "weekday", bedtime: "23:00"}
- "I wake up at 8am on weekends" → UPDATE sleep {day_type: "weekend", wakeup: "08:00"}
- "I'm most productive at night" → ADD energy_peak {peak: "late night"}""",
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
🎯 LIFESTYLE DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lifestyle.json structure:
├── hobbies[]:
│   ├── name, skill_level, notes
│   ├── specifics[]: sub-categories (strings)
│   └── references[]: {name, url, notes} ← gear, tutorials, resources
├── passions[]: strings (deep passions)
├── curiosities[]: strings (things exploring)
├── personality_traits[]: strings
├── values[]: strings (core beliefs)
└── wellness:
    ├── sleep: {weekday: {bedtime, wakeup}, weekend: {bedtime, wakeup}}
    └── energy_peaks[]: times when most productive

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

⚡ WELLNESS ROUTING:
• "I go to bed at 11pm" → UPDATE sleep {day_type: "weekday", bedtime: "23:00"}
• "I wake up at 9am" → UPDATE sleep {day_type: "weekday", wakeup: "09:00"}
• "On weekends I sleep until 10" → UPDATE sleep {day_type: "weekend", wakeup: "10:00"}
• "I'm most productive after coffee" → ADD energy_peak {peak: "after coffee"}
• "Actually not productive at night" → REMOVE energy_peak {peak: "late night"}

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

LIFESTYLE: hobby, hobby_reference, hobby_specific, 
           passion, curiosity, personality_trait, value,
           sleep, energy_peak

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
        ),
        # === SMART CONTEXT CAPTURE ===
        Tool(
            name="suggest_persona_update",
            description="""Analyze user message for persona-worthy info. Uses sentiment analysis.

Returns: {should_capture, confidence (0-1), suggestions: [{action, entity, data}]}

Actions based on confidence:
- ≥0.5: Apply via persona_modify, mention casually
- 0.4-0.5: Ask user to confirm
- <0.4: Ignore""",
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

# ════════════════════════════════════════════════════════════════════════════
# SMART CONTEXT CAPTURE - Intent Classification & Suggestion System
# ════════════════════════════════════════════════════════════════════════════

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


# =============================================================================
# SENTIMENT & STATEMENT QUALITY ANALYSIS
# =============================================================================
# This layer evaluates the QUALITY and INTENT of a statement, not just keywords.
# It helps prevent false positives from venting, hypotheticals, and casual chat.

def analyze_statement_quality(message: str, context: str = "") -> dict:
    """
    Analyze the quality and intent of a statement to determine if it's
    a genuine personal declaration worth capturing.
    
    Returns:
    {
        "statement_type": str,  # declarative, hypothetical, venting, questioning, casual
        "confidence_modifier": float,  # 0.0 - 1.0, multiplied with trigger confidence
        "reasoning": str,  # Why this classification
        "self_reference": bool,  # Does it reference self?
        "temporal_anchor": str | None,  # past, present, future, or None
    }
    """
    
    # -------------------------------------------------------------------------
    # SELF-REFERENCE DETECTION
    # -------------------------------------------------------------------------
    # Personal statements about oneself are more valuable than generic statements
    self_markers = [
        "i ", "i'm", "i've", "i'd", "i'll", "my ", "me ", "myself",
        "i am", "i have", "i was", "i will", "i would", "i could",
    ]
    has_self_reference = any(marker in message for marker in self_markers)
    
    # -------------------------------------------------------------------------
    # STATEMENT TYPE CLASSIFICATION
    # -------------------------------------------------------------------------
    
    # 1. HYPOTHETICAL/SPECULATIVE markers (low confidence)
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
    
    # 3. QUESTIONING/SEEKING ADVICE markers (context-dependent)
    questioning_markers = [
        "?",  # Any question
        "should i", "do you think i", "would you recommend",
        "what do you think about", "any advice on", "any tips for",
        "how do i", "how should i", "how can i",
        "is it worth", "is it a good idea", "does it make sense",
        "am i wrong to", "am i crazy for", "is it just me",
    ]
    
    # 4. CASUAL/FILLER markers (low signal)
    casual_markers = [
        "lol", "lmao", "haha", "hehe", "jk", "just kidding",
        "idk", "tbh", "ngl", "imo", "btw", "fwiw",
        "you know", "like", "just saying", "whatever",
        "anyway", "anywho", "so yeah", "but yeah",
        "random thought", "random but", "off topic but",
    ]
    
    # 5. DECLARATIVE/DEFINITIVE markers (high confidence)
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
    
    # 6. TEMPORAL ANCHORING (affects permanence of statement)
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
    
    # -------------------------------------------------------------------------
    # CLASSIFICATION LOGIC
    # -------------------------------------------------------------------------
    
    statement_type = "neutral"
    confidence_modifier = 0.5  # Default middle ground
    reasoning = []
    temporal_anchor = None
    
    # Check temporal anchoring
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
        confidence_modifier += 0.0  # Aspirations are useful but less certain
        reasoning.append("future aspiration")
    
    # Check for self-reference (required for high confidence)
    if has_self_reference:
        confidence_modifier += 0.15
        reasoning.append("self-referential")
    else:
        confidence_modifier -= 0.2
        reasoning.append("no self-reference")
    
    # Classify statement type
    # Check OVERRIDING patterns first (hypotheticals, venting, questions)
    # These trump declarative markers because they change the intent
    
    # Hypotheticals override everything - "What if I am..." is still hypothetical
    is_hypothetical = any(m in message for m in hypothetical_markers)
    # Check if it STARTS with a hypothetical (stronger signal)
    starts_hypothetical = message.strip().startswith(("what if", "if i", "imagine if", "hypothetically"))
    
    # Venting markers
    is_venting = any(m in message for m in venting_markers)
    
    # Question markers
    is_questioning = any(m in message for m in questioning_markers)
    
    # Declarative markers
    is_declarative = any(m in message for m in declarative_markers)
    
    # Classification priority: hypothetical > venting > questioning > declarative
    if is_hypothetical or starts_hypothetical:
        statement_type = "hypothetical"
        confidence_modifier -= 0.3
        reasoning.append("hypothetical/speculative")
    elif is_venting:
        statement_type = "venting"
        confidence_modifier -= 0.15
        reasoning.append("venting/emotional release")
        # If venting but also declarative, it might still be a real preference
        if is_declarative:
            confidence_modifier += 0.1
            reasoning.append("but declarative tone")
    elif is_questioning:
        # Questions CAN contain persona info if they're self-referential AND declarative
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
    import re
    
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
    Core analysis for a single message/sentence.
    
    Uses sentiment-aware analysis to determine if a message represents
    a genuine personal statement vs venting, hypotheticals, or casual chat.
    
    Returns:
    {
        "should_capture": bool,
        "confidence": float (0.0 - 1.0),
        "suggestions": [
            {
                "action": "add" | "update" | "remove",
                "entity": str,
                "data": dict,
                "reason": str,
                "confidence": float
            }
        ],
        "detected_triggers": [str],
        "detected_entities": [str],
        "sentiment": {
            "statement_type": str,
            "confidence_modifier": float,
            "reasoning": str
        },
        "ignore_reason": str | None
    }
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
    
    # =========================================================================
    # STEP 0: SENTIMENT & STATEMENT QUALITY ANALYSIS
    # =========================================================================
    # This determines HOW confident we are in the statement itself,
    # regardless of what triggers are matched. A declarative self-statement
    # is worth more than a hypothetical or venting session.
    
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
                break  # Only count each category once
    
    # Step 2: Check for ignore patterns ONLY if no triggers found
    # If the message has both a question AND persona info, prioritize persona info
    matched_ignore = None
    for pattern in IGNORE_PATTERNS:
        if pattern in message_lower:
            matched_ignore = pattern
            break
    
    # If we found ignore pattern but NO triggers, then ignore
    if matched_ignore and not trigger_categories:
        result["ignore_reason"] = f"Matched ignore pattern: '{matched_ignore}'"
        result["confidence"] = 0.1
        return result
    
    # Step 3: Load current persona for overlap detection
    persona = get_all_persona_data()
    existing_domains = [d.get("name", "").lower() for d in persona.get("knowledge", {}).get("domains", [])]
    existing_hobbies = [h.get("name", "").lower() for h in persona.get("lifestyle", {}).get("hobbies", [])]
    existing_projects = [p.get("name", "").lower() for p in persona.get("projects", {}).get("projects", [])]
    existing_passions = [p.lower() for p in persona.get("lifestyle", {}).get("passions", [])]
    existing_curiosities = [c.lower() for c in persona.get("lifestyle", {}).get("curiosities", [])]
    existing_dislikes = [d.lower() for d in persona.get("preferences", {}).get("dislikes", [])]
    existing_traits = [t.lower() for t in persona.get("lifestyle", {}).get("personality_traits", [])]
    
    # Step 4: Detect entities (skills, projects, etc.)
    detected_skills = []
    for skill in KNOWN_SKILLS:
        if skill in message_lower:
            detected_skills.append(skill.title() if len(skill) > 3 else skill.upper())
            result["detected_entities"].append(f"skill: {skill}")
    
    # Step 5: Generate suggestions based on triggers and entities
    suggestions = []
    
    # Learning triggers + skill detected = suggest adding domain
    if "learning" in trigger_categories and detected_skills:
        for skill in detected_skills:
            skill_lower = skill.lower()
            if skill_lower in existing_domains:
                # Already exists - maybe update level?
                if any(phrase in message_lower for phrase in ["getting better", "comfortable", "good at", "improving"]):
                    suggestions.append({
                        "action": "update",
                        "entity": "domain",
                        "data": {"name": skill, "level": "intermediate"},
                        "reason": f"Learning progress mentioned for existing skill: {skill}",
                        "confidence": 0.75
                    })
            else:
                suggestions.append({
                    "action": "add",
                    "entity": "domain",
                    "data": {"name": skill, "level": "learning"},
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
                        "data": {"name": hobby.title()},
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
    
    # State change triggers (completed, finished, etc.)
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
                    
                    import re
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
                
                if project_name and len(project_name) > 2:
                    # Check if already exists
                    if project_name.lower() not in existing_projects:
                        suggestions.append({
                            "action": "add",
                            "entity": "project",
                            "data": {"name": project_name, "status": "completed", "description": f"Created/built project"},
                            "reason": f"Achievement: {phrase} {project_name}",
                            "confidence": 0.7
                        })
                break
    
    # Wellness triggers - sleep and energy patterns
    if "wellness" in trigger_categories:
        import re
        
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
    
    # =========================================================================
    # FINAL CONFIDENCE CALCULATION
    # =========================================================================
    # Combine trigger-based confidence with sentiment quality modifier.
    # This ensures that even if triggers match, low-quality statements
    # (venting, hypotheticals, casual chat) don't get high confidence.
    
    sentiment_modifier = sentiment["confidence_modifier"]
    
    if suggestions:
        result["suggestions"] = suggestions
        
        # Apply sentiment modifier to each suggestion's confidence
        for suggestion in result["suggestions"]:
            raw_conf = suggestion["confidence"]
            adjusted_conf = raw_conf * sentiment_modifier
            suggestion["confidence"] = round(adjusted_conf, 2)
            suggestion["raw_confidence"] = raw_conf  # Keep original for debugging
        
        # Overall confidence is highest adjusted suggestion confidence
        result["confidence"] = max(s["confidence"] for s in result["suggestions"])
        
        # Only capture if adjusted confidence is still meaningful
        if result["confidence"] >= 0.4:
            result["should_capture"] = True
        else:
            result["should_capture"] = False
            result["ignore_reason"] = f"Sentiment adjustment reduced confidence below threshold (modifier: {sentiment_modifier:.2f})"
            
    elif trigger_categories:
        # Triggers detected but no concrete suggestions
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
    
    # === LIFESTYLE-BASED ENTITIES ===
    elif entity == "hobby":
        lifestyle = load_json("lifestyle.json")
        hobbies = lifestyle.setdefault("hobbies", [])
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
            save_json("lifestyle.json", lifestyle)
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
            save_json("lifestyle.json", lifestyle)
            return f"✅ Updated hobby: {name}"
        
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
        # READ operations
        if name == "get_persona":
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
            operations = arguments.get("operations", [])
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
                "detected_triggers": analysis["detected_triggers"],
                "detected_entities": analysis["detected_entities"],
                "action_required": (
                    "auto_apply" if analysis["confidence"] >= 0.8 else
                    "ask_user" if analysis["confidence"] >= 0.5 else
                    "ignore"
                ),
                "ignore_reason": analysis["ignore_reason"]
            }
            
            # Add helpful instructions for the LLM
            if response["action_required"] == "auto_apply":
                response["instruction"] = (
                    "HIGH confidence. Apply these updates using persona_modify, "
                    "then mention in your response: '✓ Updated your persona with...'"
                )
            elif response["action_required"] == "ask_user":
                response["instruction"] = (
                    "MEDIUM confidence. Ask user for confirmation before applying: "
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
