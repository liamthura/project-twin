#!/usr/bin/env python3
"""
MCP Server for Persona Data
Reads and writes persona data directly from/to JSON files.
Supports both reading and updating persona information.
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

def load_json(filename: str) -> dict:
    """Load JSON data from file"""
    path = DATA_DIR / filename
    logger.debug(f"Loading {path}")
    if not path.exists():
        logger.error(f"File not found: {path}")
        return {"error": f"{filename} not found"}
    with open(path, "r") as f:
        return json.load(f)

def save_json(filename: str, data: dict) -> bool:
    """Save JSON data to file"""
    path = DATA_DIR / filename
    logger.debug(f"Saving to {path}")
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Successfully saved {filename}")
        return True
    except Exception as e:
        logger.error(f"Error saving {filename}: {str(e)}")
        return False

def get_all_persona_data() -> dict:
    """Get all persona data"""
    return {
        "profile": load_json("profile.json"),
        "interests": load_json("interests.json"),
        "knowledge": load_json("knowledge.json"),
        "preferences": load_json("preferences.json"),
        "projects": load_json("projects.json")
    }

# Initialize MCP server
server = Server("persona-mcp")
logger.info("MCP Server instance created")

@server.list_tools()
async def list_tools():
    """List available MCP tools for persona data"""
    logger.debug("list_tools called")
    return [
        # READ tools
        Tool(
            name="get_persona",
            description="Get unified persona data including profile, interests, knowledge, preferences, and projects",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_profile",
            description="Get your persona profile",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_interests",
            description="Get your interests",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_knowledge",
            description="Get your knowledge areas",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_preferences",
            description="Get your preferences",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_projects",
            description="Get your projects",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        # UPDATE tools
        Tool(
            name="update_profile",
            description="Update a specific field in the persona profile. Use this when the user wants to update their personal information.",
            inputSchema={
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "description": "The field to update (e.g., 'bio', 'current_role', 'location')"
                    },
                    "value": {
                        "type": "string",
                        "description": "The new value for the field"
                    }
                },
                "required": ["field", "value"]
            }
        ),
        Tool(
            name="add_hobby",
            description="Add a new hobby to interests. Use when user mentions a new hobby they want to record.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the hobby"
                    },
                    "skill_level": {
                        "type": "string",
                        "description": "Skill level: beginner, enthusiast, intermediate, advanced, expert"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Additional notes about the hobby"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="add_project",
            description="Add a new project to the projects list. Use when user mentions a new project they're working on.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the project"
                    },
                    "description": {
                        "type": "string",
                        "description": "Brief description of the project"
                    },
                    "status": {
                        "type": "string",
                        "description": "Status: planning, active, paused, completed"
                    },
                    "tech_stack": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Technologies used in the project"
                    }
                },
                "required": ["name", "description"]
            }
        ),
        Tool(
            name="update_project_status",
            description="Update the status of an existing project. Use when user mentions progress on a project.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_name": {
                        "type": "string",
                        "description": "Name of the project to update"
                    },
                    "status": {
                        "type": "string",
                        "description": "New status: planning, active, paused, completed"
                    }
                },
                "required": ["project_name", "status"]
            }
        ),
        Tool(
            name="add_knowledge",
            description="Add a new knowledge area or skill. Use when user mentions learning something new.",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Category of knowledge (e.g., 'programming', 'tools', 'frameworks')"
                    },
                    "item": {
                        "type": "string",
                        "description": "The knowledge item or skill to add"
                    },
                    "proficiency": {
                        "type": "string",
                        "description": "Proficiency level: learning, familiar, proficient, expert"
                    }
                },
                "required": ["category", "item"]
            }
        ),
        Tool(
            name="add_preference",
            description="Add or update a preference. Use when user expresses a preference about tools, workflows, etc.",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Category of preference (e.g., 'development', 'communication', 'workflow')"
                    },
                    "key": {
                        "type": "string",
                        "description": "The preference key"
                    },
                    "value": {
                        "type": "string",
                        "description": "The preference value"
                    }
                },
                "required": ["category", "key", "value"]
            }
        ),
        Tool(
            name="record_learning",
            description="Record something new the user learned during conversation. Adds to knowledge base.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic or subject learned"
                    },
                    "details": {
                        "type": "string",
                        "description": "Details about what was learned"
                    },
                    "source": {
                        "type": "string",
                        "description": "Where this was learned (e.g., 'conversation', 'project work')"
                    }
                },
                "required": ["topic", "details"]
            }
        ),
        # UPDATE EXISTING tools
        Tool(
            name="update_hobby",
            description="Update an existing hobby's details including nested fields. Use when user wants to modify hobby info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the hobby to update"
                    },
                    "field": {
                        "type": "string",
                        "description": "Field to update: skill_level, notes, specifics, or nested like references.add, references.remove, references.update"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value. For references.add: 'name|url|notes'. For references.update: 'ref_name|field_to_update|new_value'. For references.remove: 'ref_name'"
                    }
                },
                "required": ["name", "field", "value"]
            }
        ),
        Tool(
            name="update_project",
            description="Update an existing project's details including nested fields like challenges, goals, tech_stack.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the project to update"
                    },
                    "field": {
                        "type": "string",
                        "description": "Field to update: description, status, url, or nested like tech_stack.add/remove/update, challenges.add/remove/update, goals.add/remove/update"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value. For .add: item to add. For .remove: item to remove. For .update: 'old_value|new_value'. For full replacement: comma-separated list."
                    }
                },
                "required": ["name", "field", "value"]
            }
        ),
        Tool(
            name="update_knowledge",
            description="Update an existing knowledge item's proficiency, details, or rename it.",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Category where the knowledge item exists"
                    },
                    "item": {
                        "type": "string",
                        "description": "Name of the knowledge item to update"
                    },
                    "field": {
                        "type": "string",
                        "description": "Field to update: proficiency, name, notes"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value for the field"
                    }
                },
                "required": ["category", "item", "field", "value"]
            }
        ),
        Tool(
            name="remove_hobby",
            description="Remove a hobby from the interests list.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the hobby to remove"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="remove_project",
            description="Remove a project from the projects list.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the project to remove"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="remove_knowledge",
            description="Remove a knowledge item from a category.",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Category where the knowledge item exists"
                    },
                    "item": {
                        "type": "string",
                        "description": "Name of the knowledge item to remove"
                    }
                },
                "required": ["category", "item"]
            }
        ),
        # CONTACT MANAGEMENT tools
        Tool(
            name="add_email",
            description="Add a new email address to the contact info. Use when user wants to add an email.",
            inputSchema={
                "type": "object",
                "properties": {
                    "address": {
                        "type": "string",
                        "description": "The email address (e.g., 'user@example.com')"
                    },
                    "purpose": {
                        "type": "string",
                        "description": "Purpose of this email: primary, work, personal, academic, etc."
                    }
                },
                "required": ["address", "purpose"]
            }
        ),
        Tool(
            name="update_email",
            description="Update an existing email address or its purpose.",
            inputSchema={
                "type": "object",
                "properties": {
                    "old_address": {
                        "type": "string",
                        "description": "The current email address to update"
                    },
                    "new_address": {
                        "type": "string",
                        "description": "The new email address (optional, leave empty to keep same)"
                    },
                    "purpose": {
                        "type": "string",
                        "description": "New purpose for this email (optional)"
                    }
                },
                "required": ["old_address"]
            }
        ),
        Tool(
            name="remove_email",
            description="Remove an email address from contact info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "address": {
                        "type": "string",
                        "description": "The email address to remove"
                    }
                },
                "required": ["address"]
            }
        ),
        Tool(
            name="add_link",
            description="Add a new link to the contact info (portfolio, website, etc.).",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL of the link"
                    },
                    "label": {
                        "type": "string",
                        "description": "Label for the link (e.g., 'Portfolio', 'Personal Blog')"
                    }
                },
                "required": ["url", "label"]
            }
        ),
        Tool(
            name="remove_link",
            description="Remove a link from contact info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "description": "The label of the link to remove"
                    }
                },
                "required": ["label"]
            }
        ),
        # LANGUAGE MANAGEMENT tools
        Tool(
            name="add_language",
            description="Add a new language to languages_spoken.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the language (e.g., 'Spanish', 'Japanese')"
                    },
                    "fluency": {
                        "type": "string",
                        "description": "Fluency level: native, professional, conversational, basic"
                    }
                },
                "required": ["name", "fluency"]
            }
        ),
        Tool(
            name="update_language",
            description="Update an existing language's fluency level.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the language to update"
                    },
                    "fluency": {
                        "type": "string",
                        "description": "New fluency level: native, professional, conversational, basic"
                    }
                },
                "required": ["name", "fluency"]
            }
        ),
        Tool(
            name="remove_language",
            description="Remove a language from languages_spoken.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the language to remove"
                    }
                },
                "required": ["name"]
            }
        ),
        # WORK EXPERIENCE MANAGEMENT tools
        Tool(
            name="add_work_experience",
            description="Add a new work experience entry.",
            inputSchema={
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "Job title/role"
                    },
                    "company": {
                        "type": "string",
                        "description": "Company name"
                    },
                    "type": {
                        "type": "string",
                        "description": "Type: Full-time, Part-time, Internship, Placement Year, Contract"
                    },
                    "period": {
                        "type": "string",
                        "description": "Time period (e.g., '2023-2024', 'Jan 2023 - Present')"
                    },
                    "highlights": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key achievements/highlights (optional)"
                    }
                },
                "required": ["role", "company", "type", "period"]
            }
        ),
        Tool(
            name="update_work_experience",
            description="Update an existing work experience entry or add highlights.",
            inputSchema={
                "type": "object",
                "properties": {
                    "company": {
                        "type": "string",
                        "description": "Company name to identify the entry"
                    },
                    "field": {
                        "type": "string",
                        "description": "Field to update: role, type, period, or 'highlights.add', 'highlights.remove'"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value for the field"
                    }
                },
                "required": ["company", "field", "value"]
            }
        ),
        Tool(
            name="remove_work_experience",
            description="Remove a work experience entry.",
            inputSchema={
                "type": "object",
                "properties": {
                    "company": {
                        "type": "string",
                        "description": "Company name to identify and remove"
                    }
                },
                "required": ["company"]
            }
        ),
        # COURSEWORK MANAGEMENT tools
        Tool(
            name="add_coursework",
            description="Add a new coursework/course to education.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the course/module"
                    },
                    "topics": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of topics covered in the course"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="update_coursework",
            description="Update a coursework entry (add/remove topics).",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the course to update"
                    },
                    "action": {
                        "type": "string",
                        "description": "Action: 'topics.add', 'topics.remove', 'rename'"
                    },
                    "value": {
                        "type": "string",
                        "description": "Topic to add/remove, or new name for rename"
                    }
                },
                "required": ["name", "action", "value"]
            }
        ),
        Tool(
            name="remove_coursework",
            description="Remove a coursework entry.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the course to remove"
                    }
                },
                "required": ["name"]
            }
        ),
        # CURRENT LEARNING MANAGEMENT tools
        Tool(
            name="add_current_learning",
            description="Add a new current learning topic/goal.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic being learned"
                    },
                    "context": {
                        "type": "string",
                        "description": "Context or reason for learning this"
                    },
                    "priority": {
                        "type": "string",
                        "description": "Priority level: high, medium, low"
                    }
                },
                "required": ["topic", "context", "priority"]
            }
        ),
        Tool(
            name="update_current_learning",
            description="Update a current learning entry.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Topic name to identify the entry"
                    },
                    "field": {
                        "type": "string",
                        "description": "Field to update: context, priority"
                    },
                    "value": {
                        "type": "string",
                        "description": "New value for the field"
                    }
                },
                "required": ["topic", "field", "value"]
            }
        ),
        Tool(
            name="remove_current_learning",
            description="Remove a current learning entry.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Topic to remove"
                    }
                },
                "required": ["topic"]
            }
        ),
        # TOP OF MIND MANAGEMENT tools
        Tool(
            name="add_top_of_mind",
            description="Add a new top-of-mind item (current priority/focus).",
            inputSchema={
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "The item/topic that's top of mind"
                    }
                },
                "required": ["item"]
            }
        ),
        Tool(
            name="remove_top_of_mind",
            description="Remove a top-of-mind item.",
            inputSchema={
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "The item to remove"
                    }
                },
                "required": ["item"]
            }
        ),
        # CAREER ASPIRATIONS tools
        Tool(
            name="add_career_aspiration",
            description="Add a new career aspiration.",
            inputSchema={
                "type": "object",
                "properties": {
                    "aspiration": {
                        "type": "string",
                        "description": "The career aspiration to add"
                    }
                },
                "required": ["aspiration"]
            }
        ),
        Tool(
            name="remove_career_aspiration",
            description="Remove a career aspiration.",
            inputSchema={
                "type": "object",
                "properties": {
                    "aspiration": {
                        "type": "string",
                        "description": "The aspiration to remove"
                    }
                },
                "required": ["aspiration"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle tool calls"""
    logger.info(f"call_tool invoked: name={name}, arguments={arguments}")
    try:
        # READ operations
        if name == "get_persona":
            data = get_all_persona_data()
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        elif name == "get_profile":
            data = load_json("profile.json")
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        elif name == "get_interests":
            data = load_json("interests.json")
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        elif name == "get_knowledge":
            data = load_json("knowledge.json")
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        elif name == "get_preferences":
            data = load_json("preferences.json")
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        elif name == "get_projects":
            data = load_json("projects.json")
            return [TextContent(type="text", text=json.dumps(data, indent=2))]
        
        # UPDATE operations
        elif name == "update_profile":
            field = arguments.get("field")
            value = arguments.get("value")
            profile = load_json("profile.json")
            
            # Handle nested fields (e.g., "contact.github")
            if "." in field:
                parts = field.split(".")
                obj = profile
                for part in parts[:-1]:
                    obj = obj.setdefault(part, {})
                obj[parts[-1]] = value
            else:
                profile[field] = value
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Updated profile.{field} to: {value}")]
            return [TextContent(type="text", text=f"❌ Failed to update profile")]
        
        elif name == "add_hobby":
            interests = load_json("interests.json")
            new_hobby = {
                "name": arguments.get("name"),
                "specifics": [],
                "skill_level": arguments.get("skill_level", "enthusiast"),
                "notes": arguments.get("notes", ""),
                "references": []
            }
            
            # Check if hobby already exists
            existing = next((h for h in interests.get("hobbies", []) if h["name"].lower() == new_hobby["name"].lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Hobby '{new_hobby['name']}' already exists")]
            
            interests.setdefault("hobbies", []).append(new_hobby)
            if save_json("interests.json", interests):
                return [TextContent(type="text", text=f"✅ Added new hobby: {new_hobby['name']}")]
            return [TextContent(type="text", text=f"❌ Failed to add hobby")]
        
        elif name == "add_project":
            projects = load_json("projects.json")
            new_project = {
                "name": arguments.get("name"),
                "description": arguments.get("description"),
                "status": arguments.get("status", "planning"),
                "tech_stack": arguments.get("tech_stack", []),
                "added_date": datetime.now().strftime("%Y-%m-%d")
            }
            
            # Check if project already exists
            existing = next((p for p in projects.get("projects", []) if p["name"].lower() == new_project["name"].lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Project '{new_project['name']}' already exists")]
            
            projects.setdefault("projects", []).append(new_project)
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Added new project: {new_project['name']}")]
            return [TextContent(type="text", text=f"❌ Failed to add project")]
        
        elif name == "update_project_status":
            project_name = arguments.get("project_name")
            new_status = arguments.get("status")
            projects = load_json("projects.json")
            
            # Find and update project
            found = False
            for project in projects.get("projects", []):
                if project["name"].lower() == project_name.lower():
                    old_status = project.get("status", "unknown")
                    project["status"] = new_status
                    project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
                    found = True
                    break
            
            if not found:
                return [TextContent(type="text", text=f"❌ Project '{project_name}' not found")]
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Updated '{project_name}' status: {old_status} → {new_status}")]
            return [TextContent(type="text", text=f"❌ Failed to update project status")]
        
        elif name == "add_knowledge":
            category = arguments.get("category")
            item = arguments.get("item")
            proficiency = arguments.get("proficiency", "learning")
            knowledge = load_json("knowledge.json")
            
            # Add to category
            if category not in knowledge:
                knowledge[category] = []
            
            # Check if already exists
            existing = next((k for k in knowledge[category] if isinstance(k, dict) and k.get("name", "").lower() == item.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ '{item}' already exists in {category}")]
            
            knowledge[category].append({
                "name": item,
                "proficiency": proficiency,
                "added_date": datetime.now().strftime("%Y-%m-%d")
            })
            
            if save_json("knowledge.json", knowledge):
                return [TextContent(type="text", text=f"✅ Added '{item}' to {category} (proficiency: {proficiency})")]
            return [TextContent(type="text", text=f"❌ Failed to add knowledge")]
        
        elif name == "add_preference":
            category = arguments.get("category")
            key = arguments.get("key")
            value = arguments.get("value")
            preferences = load_json("preferences.json")
            
            # Ensure category exists
            if category not in preferences:
                preferences[category] = {}
            
            preferences[category][key] = value
            
            if save_json("preferences.json", preferences):
                return [TextContent(type="text", text=f"✅ Set preference {category}.{key} = {value}")]
            return [TextContent(type="text", text=f"❌ Failed to add preference")]
        
        elif name == "record_learning":
            topic = arguments.get("topic")
            details = arguments.get("details")
            source = arguments.get("source", "conversation")
            knowledge = load_json("knowledge.json")
            
            # Add to learnings section
            if "learnings" not in knowledge:
                knowledge["learnings"] = []
            
            knowledge["learnings"].append({
                "topic": topic,
                "details": details,
                "source": source,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M")
            })
            
            if save_json("knowledge.json", knowledge):
                return [TextContent(type="text", text=f"✅ Recorded learning: {topic}")]
            return [TextContent(type="text", text=f"❌ Failed to record learning")]
        
        # UPDATE EXISTING handlers
        elif name == "update_hobby":
            hobby_name = arguments.get("name")
            field = arguments.get("field")
            value = arguments.get("value")
            interests = load_json("interests.json")
            
            # Find hobby
            hobby = next((h for h in interests.get("hobbies", []) if h["name"].lower() == hobby_name.lower()), None)
            if not hobby:
                return [TextContent(type="text", text=f"❌ Hobby '{hobby_name}' not found")]
            
            # Handle nested field operations (e.g., references.add, specifics.add)
            if "." in field:
                parts = field.split(".")
                base_field = parts[0]
                operation = parts[1]
                
                if base_field == "references":
                    if "references" not in hobby:
                        hobby["references"] = []
                    
                    if operation == "add":
                        # Parse JSON or simple format
                        try:
                            ref = json.loads(value)
                        except json.JSONDecodeError:
                            # Simple format: "name|url|notes" or just "name"
                            parts = value.split("|")
                            ref = {
                                "name": parts[0].strip(),
                                "url": parts[1].strip() if len(parts) > 1 else "",
                                "notes": parts[2].strip() if len(parts) > 2 else ""
                            }
                        hobby["references"].append(ref)
                        result_msg = f"✅ Added reference '{ref['name']}' to hobby '{hobby_name}'"
                    
                    elif operation == "update":
                        # Format: "ref_name|field_to_update|new_value"
                        parts = value.split("|")
                        if len(parts) < 3:
                            return [TextContent(type="text", text=f"❌ Format should be: ref_name|field|new_value")]
                        ref_name = parts[0].strip()
                        ref_field = parts[1].strip()
                        ref_value = parts[2].strip()
                        
                        # Find the reference
                        ref = next((r for r in hobby["references"] if r.get("name", "").lower() == ref_name.lower()), None)
                        if not ref:
                            return [TextContent(type="text", text=f"❌ Reference '{ref_name}' not found in hobby")]
                        
                        ref[ref_field] = ref_value
                        result_msg = f"✅ Updated reference '{ref_name}': {ref_field} = {ref_value}"
                    
                    elif operation == "remove":
                        original_count = len(hobby["references"])
                        hobby["references"] = [r for r in hobby["references"] if r.get("name", "").lower() != value.lower()]
                        if len(hobby["references"]) == original_count:
                            return [TextContent(type="text", text=f"❌ Reference '{value}' not found in hobby")]
                        result_msg = f"✅ Removed reference '{value}' from hobby '{hobby_name}'"
                    else:
                        return [TextContent(type="text", text=f"❌ Unknown operation '{operation}' for references. Use: add, update, or remove")]
                
                elif base_field == "specifics":
                    if "specifics" not in hobby:
                        hobby["specifics"] = []
                    
                    if operation == "add":
                        hobby["specifics"].append(value.strip())
                        result_msg = f"✅ Added '{value}' to specifics of '{hobby_name}'"
                    elif operation == "remove":
                        if value.strip() in hobby["specifics"]:
                            hobby["specifics"].remove(value.strip())
                            result_msg = f"✅ Removed '{value}' from specifics of '{hobby_name}'"
                        else:
                            return [TextContent(type="text", text=f"❌ '{value}' not found in specifics")]
                    else:
                        return [TextContent(type="text", text=f"❌ Unknown operation '{operation}' for specifics")]
                else:
                    return [TextContent(type="text", text=f"❌ Unknown nested field '{base_field}'")]
            else:
                # Simple field update
                if field == "specifics":
                    hobby["specifics"] = [s.strip() for s in value.split(",")]
                else:
                    hobby[field] = value
                result_msg = f"✅ Updated hobby '{hobby_name}': {field} = {value}"
            
            hobby["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            
            if save_json("interests.json", interests):
                return [TextContent(type="text", text=result_msg)]
            return [TextContent(type="text", text=f"❌ Failed to update hobby")]
        
        elif name == "update_project":
            project_name = arguments.get("name")
            field = arguments.get("field")
            value = arguments.get("value")
            projects = load_json("projects.json")
            
            # Find project
            project = next((p for p in projects.get("projects", []) if p["name"].lower() == project_name.lower()), None)
            if not project:
                return [TextContent(type="text", text=f"❌ Project '{project_name}' not found")]
            
            # Handle nested field operations (e.g., tech_stack.add, challenges.remove)
            if "." in field:
                parts = field.split(".")
                base_field = parts[0]
                operation = parts[1]
                
                if base_field in ["tech_stack", "challenges", "goals"]:
                    if base_field not in project:
                        project[base_field] = []
                    
                    if operation == "add":
                        project[base_field].append(value.strip())
                        result_msg = f"✅ Added '{value}' to {base_field} of '{project_name}'"
                    
                    elif operation == "update":
                        # Format: "old_value|new_value"
                        parts = value.split("|")
                        if len(parts) < 2:
                            return [TextContent(type="text", text=f"❌ Format should be: old_value|new_value")]
                        old_val = parts[0].strip()
                        new_val = parts[1].strip()
                        
                        # Find and update (case-insensitive search)
                        found = False
                        for i, item in enumerate(project[base_field]):
                            if item.lower() == old_val.lower():
                                project[base_field][i] = new_val
                                found = True
                                break
                        
                        if not found:
                            return [TextContent(type="text", text=f"❌ '{old_val}' not found in {base_field}")]
                        result_msg = f"✅ Updated {base_field}: '{old_val}' → '{new_val}'"
                    
                    elif operation == "remove":
                        # Case-insensitive removal
                        original = project[base_field].copy()
                        project[base_field] = [item for item in project[base_field] if item.lower() != value.lower()]
                        if len(project[base_field]) == len(original):
                            return [TextContent(type="text", text=f"❌ '{value}' not found in {base_field}")]
                        result_msg = f"✅ Removed '{value}' from {base_field} of '{project_name}'"
                    else:
                        return [TextContent(type="text", text=f"❌ Unknown operation '{operation}'. Use: add, update, or remove")]
                else:
                    return [TextContent(type="text", text=f"❌ Unknown nested field '{base_field}'")]
            else:
                # Simple field update (handle arrays)
                if field in ["tech_stack", "challenges", "goals"]:
                    project[field] = [s.strip() for s in value.split(",")]
                else:
                    project[field] = value
                result_msg = f"✅ Updated project '{project_name}': {field} = {value}"
            
            project["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=result_msg)]
            return [TextContent(type="text", text=f"❌ Failed to update project")]
        
        elif name == "update_knowledge":
            category = arguments.get("category")
            item_name = arguments.get("item")
            field = arguments.get("field")
            value = arguments.get("value")
            knowledge = load_json("knowledge.json")
            
            if category not in knowledge:
                return [TextContent(type="text", text=f"❌ Category '{category}' not found")]
            
            # Find and update item
            found = False
            for item in knowledge[category]:
                if isinstance(item, dict) and item.get("name", "").lower() == item_name.lower():
                    item[field] = value
                    item["last_updated"] = datetime.now().strftime("%Y-%m-%d")
                    found = True
                    break
                elif isinstance(item, str) and item.lower() == item_name.lower():
                    # Convert string item to dict if updating
                    idx = knowledge[category].index(item)
                    knowledge[category][idx] = {
                        "name": item if field != "name" else value,
                        field: value,
                        "last_updated": datetime.now().strftime("%Y-%m-%d")
                    }
                    found = True
                    break
            
            if not found:
                return [TextContent(type="text", text=f"❌ Knowledge item '{item_name}' not found in {category}")]
            
            if save_json("knowledge.json", knowledge):
                return [TextContent(type="text", text=f"✅ Updated '{item_name}' in {category}: {field} = {value}")]
            return [TextContent(type="text", text=f"❌ Failed to update knowledge")]
        
        # REMOVE handlers
        elif name == "remove_hobby":
            hobby_name = arguments.get("name")
            interests = load_json("interests.json")
            
            original_count = len(interests.get("hobbies", []))
            interests["hobbies"] = [h for h in interests.get("hobbies", []) if h["name"].lower() != hobby_name.lower()]
            
            if len(interests["hobbies"]) == original_count:
                return [TextContent(type="text", text=f"❌ Hobby '{hobby_name}' not found")]
            
            if save_json("interests.json", interests):
                return [TextContent(type="text", text=f"✅ Removed hobby: {hobby_name}")]
            return [TextContent(type="text", text=f"❌ Failed to remove hobby")]
        
        elif name == "remove_project":
            project_name = arguments.get("name")
            projects = load_json("projects.json")
            
            original_count = len(projects.get("projects", []))
            projects["projects"] = [p for p in projects.get("projects", []) if p["name"].lower() != project_name.lower()]
            
            if len(projects["projects"]) == original_count:
                return [TextContent(type="text", text=f"❌ Project '{project_name}' not found")]
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Removed project: {project_name}")]
            return [TextContent(type="text", text=f"❌ Failed to remove project")]
        
        elif name == "remove_knowledge":
            category = arguments.get("category")
            item_name = arguments.get("item")
            knowledge = load_json("knowledge.json")
            
            if category not in knowledge:
                return [TextContent(type="text", text=f"❌ Category '{category}' not found")]
            
            original_count = len(knowledge[category])
            knowledge[category] = [k for k in knowledge[category] if not (isinstance(k, dict) and k.get("name", "").lower() == item_name.lower())]
            
            if len(knowledge[category]) == original_count:
                return [TextContent(type="text", text=f"❌ Knowledge item '{item_name}' not found in {category}")]
            
            if save_json("knowledge.json", knowledge):
                return [TextContent(type="text", text=f"✅ Removed '{item_name}' from {category}")]
            return [TextContent(type="text", text=f"❌ Failed to remove knowledge")]
        
        # CONTACT MANAGEMENT handlers
        elif name == "add_email":
            address = arguments.get("address")
            purpose = arguments.get("purpose")
            profile = load_json("profile.json")
            
            # Ensure contact.emails exists
            if "contact" not in profile:
                profile["contact"] = {}
            if "emails" not in profile["contact"]:
                profile["contact"]["emails"] = []
            
            # Check for duplicate
            existing = next((e for e in profile["contact"]["emails"] if e.get("address", "").lower() == address.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Email '{address}' already exists with purpose: {existing.get('purpose')}")]
            
            # Add properly formatted email
            profile["contact"]["emails"].append({
                "address": address,
                "purpose": purpose
            })
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added email: {address} ({purpose})")]
            return [TextContent(type="text", text=f"❌ Failed to add email")]
        
        elif name == "update_email":
            old_address = arguments.get("old_address")
            new_address = arguments.get("new_address", "")
            new_purpose = arguments.get("purpose", "")
            profile = load_json("profile.json")
            
            emails = profile.get("contact", {}).get("emails", [])
            found = False
            
            for email in emails:
                if email.get("address", "").lower() == old_address.lower():
                    if new_address:
                        email["address"] = new_address
                    if new_purpose:
                        email["purpose"] = new_purpose
                    found = True
                    break
            
            if not found:
                return [TextContent(type="text", text=f"❌ Email '{old_address}' not found")]
            
            if save_json("profile.json", profile):
                updated = new_address if new_address else old_address
                return [TextContent(type="text", text=f"✅ Updated email: {updated}")]
            return [TextContent(type="text", text=f"❌ Failed to update email")]
        
        elif name == "remove_email":
            address = arguments.get("address")
            profile = load_json("profile.json")
            
            emails = profile.get("contact", {}).get("emails", [])
            original_count = len(emails)
            profile["contact"]["emails"] = [e for e in emails if e.get("address", "").lower() != address.lower()]
            
            if len(profile["contact"]["emails"]) == original_count:
                return [TextContent(type="text", text=f"❌ Email '{address}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed email: {address}")]
            return [TextContent(type="text", text=f"❌ Failed to remove email")]
        
        elif name == "add_link":
            url = arguments.get("url")
            label = arguments.get("label")
            profile = load_json("profile.json")
            
            # Ensure contact.links exists
            if "contact" not in profile:
                profile["contact"] = {}
            if "links" not in profile["contact"]:
                profile["contact"]["links"] = []
            
            # Check for duplicate
            existing = next((l for l in profile["contact"]["links"] if l.get("label", "").lower() == label.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Link '{label}' already exists: {existing.get('url')}")]
            
            # Add properly formatted link
            profile["contact"]["links"].append({
                "url": url,
                "label": label
            })
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added link: {label} ({url})")]
            return [TextContent(type="text", text=f"❌ Failed to add link")]
        
        elif name == "remove_link":
            label = arguments.get("label")
            profile = load_json("profile.json")
            
            links = profile.get("contact", {}).get("links", [])
            original_count = len(links)
            profile["contact"]["links"] = [l for l in links if l.get("label", "").lower() != label.lower()]
            
            if len(profile["contact"]["links"]) == original_count:
                return [TextContent(type="text", text=f"❌ Link '{label}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed link: {label}")]
            return [TextContent(type="text", text=f"❌ Failed to remove link")]
        
        # LANGUAGE MANAGEMENT handlers
        elif name == "add_language":
            lang_name = arguments.get("name")
            fluency = arguments.get("fluency")
            profile = load_json("profile.json")
            
            if "languages_spoken" not in profile:
                profile["languages_spoken"] = []
            
            # Check for duplicate
            existing = next((l for l in profile["languages_spoken"] if l.get("name", "").lower() == lang_name.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Language '{lang_name}' already exists with fluency: {existing.get('fluency')}")]
            
            profile["languages_spoken"].append({
                "name": lang_name,
                "fluency": fluency
            })
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added language: {lang_name} ({fluency})")]
            return [TextContent(type="text", text=f"❌ Failed to add language")]
        
        elif name == "update_language":
            lang_name = arguments.get("name")
            fluency = arguments.get("fluency")
            profile = load_json("profile.json")
            
            found = False
            for lang in profile.get("languages_spoken", []):
                if lang.get("name", "").lower() == lang_name.lower():
                    lang["fluency"] = fluency
                    found = True
                    break
            
            if not found:
                return [TextContent(type="text", text=f"❌ Language '{lang_name}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Updated {lang_name} fluency to: {fluency}")]
            return [TextContent(type="text", text=f"❌ Failed to update language")]
        
        elif name == "remove_language":
            lang_name = arguments.get("name")
            profile = load_json("profile.json")
            
            original_count = len(profile.get("languages_spoken", []))
            profile["languages_spoken"] = [l for l in profile.get("languages_spoken", []) if l.get("name", "").lower() != lang_name.lower()]
            
            if len(profile["languages_spoken"]) == original_count:
                return [TextContent(type="text", text=f"❌ Language '{lang_name}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed language: {lang_name}")]
            return [TextContent(type="text", text=f"❌ Failed to remove language")]
        
        # WORK EXPERIENCE handlers
        elif name == "add_work_experience":
            role = arguments.get("role")
            company = arguments.get("company")
            work_type = arguments.get("type")
            period = arguments.get("period")
            highlights = arguments.get("highlights", [])
            profile = load_json("profile.json")
            
            if "work_experience" not in profile:
                profile["work_experience"] = []
            
            # Check for duplicate
            existing = next((w for w in profile["work_experience"] if w.get("company", "").lower() == company.lower() and w.get("role", "").lower() == role.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Work experience at '{company}' as '{role}' already exists")]
            
            profile["work_experience"].append({
                "role": role,
                "company": company,
                "type": work_type,
                "period": period,
                "highlights": highlights if isinstance(highlights, list) else []
            })
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added work experience: {role} at {company}")]
            return [TextContent(type="text", text=f"❌ Failed to add work experience")]
        
        elif name == "update_work_experience":
            company = arguments.get("company")
            field = arguments.get("field")
            value = arguments.get("value")
            profile = load_json("profile.json")
            
            # Find the work experience entry
            work = next((w for w in profile.get("work_experience", []) if w.get("company", "").lower() == company.lower()), None)
            if not work:
                return [TextContent(type="text", text=f"❌ Work experience at '{company}' not found")]
            
            # Handle nested operations for highlights
            if "." in field:
                parts = field.split(".")
                base_field = parts[0]
                operation = parts[1]
                
                if base_field == "highlights":
                    if "highlights" not in work:
                        work["highlights"] = []
                    
                    if operation == "add":
                        work["highlights"].append(value)
                        result_msg = f"✅ Added highlight to {company}: {value}"
                    elif operation == "remove":
                        if value in work["highlights"]:
                            work["highlights"].remove(value)
                            result_msg = f"✅ Removed highlight from {company}: {value}"
                        else:
                            return [TextContent(type="text", text=f"❌ Highlight not found")]
                    else:
                        return [TextContent(type="text", text=f"❌ Unknown operation '{operation}'. Use: add or remove")]
                else:
                    return [TextContent(type="text", text=f"❌ Unknown nested field '{base_field}'")]
            else:
                work[field] = value
                result_msg = f"✅ Updated {company}: {field} = {value}"
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=result_msg)]
            return [TextContent(type="text", text=f"❌ Failed to update work experience")]
        
        elif name == "remove_work_experience":
            company = arguments.get("company")
            profile = load_json("profile.json")
            
            original_count = len(profile.get("work_experience", []))
            profile["work_experience"] = [w for w in profile.get("work_experience", []) if w.get("company", "").lower() != company.lower()]
            
            if len(profile["work_experience"]) == original_count:
                return [TextContent(type="text", text=f"❌ Work experience at '{company}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed work experience at: {company}")]
            return [TextContent(type="text", text=f"❌ Failed to remove work experience")]
        
        # COURSEWORK handlers
        elif name == "add_coursework":
            course_name = arguments.get("name")
            topics = arguments.get("topics", [])
            profile = load_json("profile.json")
            
            # Add to education.coursework
            if "education" not in profile:
                profile["education"] = {}
            if "coursework" not in profile["education"]:
                profile["education"]["coursework"] = []
            
            # Check for duplicate
            existing = next((c for c in profile["education"]["coursework"] if c.get("name", "").lower() == course_name.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Coursework '{course_name}' already exists")]
            
            profile["education"]["coursework"].append({
                "name": course_name,
                "topics": topics if isinstance(topics, list) else []
            })
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added coursework: {course_name}")]
            return [TextContent(type="text", text=f"❌ Failed to add coursework")]
        
        elif name == "update_coursework":
            course_name = arguments.get("name")
            action = arguments.get("action")
            value = arguments.get("value")
            profile = load_json("profile.json")
            
            # Find the coursework
            course = next((c for c in profile.get("education", {}).get("coursework", []) if c.get("name", "").lower() == course_name.lower()), None)
            if not course:
                return [TextContent(type="text", text=f"❌ Coursework '{course_name}' not found")]
            
            if action == "topics.add":
                if "topics" not in course:
                    course["topics"] = []
                course["topics"].append(value)
                result_msg = f"✅ Added topic to {course_name}: {value}"
            elif action == "topics.remove":
                if value in course.get("topics", []):
                    course["topics"].remove(value)
                    result_msg = f"✅ Removed topic from {course_name}: {value}"
                else:
                    return [TextContent(type="text", text=f"❌ Topic '{value}' not found in course")]
            elif action == "rename":
                course["name"] = value
                result_msg = f"✅ Renamed course to: {value}"
            else:
                return [TextContent(type="text", text=f"❌ Unknown action '{action}'. Use: topics.add, topics.remove, or rename")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=result_msg)]
            return [TextContent(type="text", text=f"❌ Failed to update coursework")]
        
        elif name == "remove_coursework":
            course_name = arguments.get("name")
            profile = load_json("profile.json")
            
            coursework = profile.get("education", {}).get("coursework", [])
            original_count = len(coursework)
            profile["education"]["coursework"] = [c for c in coursework if c.get("name", "").lower() != course_name.lower()]
            
            if len(profile["education"]["coursework"]) == original_count:
                return [TextContent(type="text", text=f"❌ Coursework '{course_name}' not found")]
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed coursework: {course_name}")]
            return [TextContent(type="text", text=f"❌ Failed to remove coursework")]
        
        # CURRENT LEARNING handlers
        elif name == "add_current_learning":
            topic = arguments.get("topic")
            context = arguments.get("context")
            priority = arguments.get("priority")
            projects = load_json("projects.json")
            
            if "current_learning" not in projects:
                projects["current_learning"] = []
            
            # Check for duplicate
            existing = next((l for l in projects["current_learning"] if l.get("topic", "").lower() == topic.lower()), None)
            if existing:
                return [TextContent(type="text", text=f"ℹ️ Learning topic '{topic}' already exists")]
            
            projects["current_learning"].append({
                "topic": topic,
                "context": context,
                "priority": priority
            })
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Added current learning: {topic} (priority: {priority})")]
            return [TextContent(type="text", text=f"❌ Failed to add current learning")]
        
        elif name == "update_current_learning":
            topic = arguments.get("topic")
            field = arguments.get("field")
            value = arguments.get("value")
            projects = load_json("projects.json")
            
            # Find the learning item
            learning = next((l for l in projects.get("current_learning", []) if l.get("topic", "").lower() == topic.lower()), None)
            if not learning:
                return [TextContent(type="text", text=f"❌ Learning topic '{topic}' not found")]
            
            learning[field] = value
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Updated learning '{topic}': {field} = {value}")]
            return [TextContent(type="text", text=f"❌ Failed to update current learning")]
        
        elif name == "remove_current_learning":
            topic = arguments.get("topic")
            projects = load_json("projects.json")
            
            original_count = len(projects.get("current_learning", []))
            projects["current_learning"] = [l for l in projects.get("current_learning", []) if l.get("topic", "").lower() != topic.lower()]
            
            if len(projects["current_learning"]) == original_count:
                return [TextContent(type="text", text=f"❌ Learning topic '{topic}' not found")]
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Removed current learning: {topic}")]
            return [TextContent(type="text", text=f"❌ Failed to remove current learning")]
        
        # TOP OF MIND handlers
        elif name == "add_top_of_mind":
            item = arguments.get("item")
            projects = load_json("projects.json")
            
            if "top_of_mind" not in projects:
                projects["top_of_mind"] = []
            
            if item in projects["top_of_mind"]:
                return [TextContent(type="text", text=f"ℹ️ '{item}' is already top of mind")]
            
            projects["top_of_mind"].append(item)
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Added to top of mind: {item}")]
            return [TextContent(type="text", text=f"❌ Failed to add to top of mind")]
        
        elif name == "remove_top_of_mind":
            item = arguments.get("item")
            projects = load_json("projects.json")
            
            # Case-insensitive search
            found_item = next((i for i in projects.get("top_of_mind", []) if i.lower() == item.lower()), None)
            if not found_item:
                return [TextContent(type="text", text=f"❌ '{item}' not found in top of mind")]
            
            projects["top_of_mind"].remove(found_item)
            
            if save_json("projects.json", projects):
                return [TextContent(type="text", text=f"✅ Removed from top of mind: {item}")]
            return [TextContent(type="text", text=f"❌ Failed to remove from top of mind")]
        
        # CAREER ASPIRATIONS handlers
        elif name == "add_career_aspiration":
            aspiration = arguments.get("aspiration")
            profile = load_json("profile.json")
            
            if "career_aspirations" not in profile:
                profile["career_aspirations"] = []
            
            if aspiration in profile["career_aspirations"]:
                return [TextContent(type="text", text=f"ℹ️ '{aspiration}' is already in career aspirations")]
            
            profile["career_aspirations"].append(aspiration)
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Added career aspiration: {aspiration}")]
            return [TextContent(type="text", text=f"❌ Failed to add career aspiration")]
        
        elif name == "remove_career_aspiration":
            aspiration = arguments.get("aspiration")
            profile = load_json("profile.json")
            
            # Case-insensitive search
            found = next((a for a in profile.get("career_aspirations", []) if a.lower() == aspiration.lower()), None)
            if not found:
                return [TextContent(type="text", text=f"❌ '{aspiration}' not found in career aspirations")]
            
            profile["career_aspirations"].remove(found)
            
            if save_json("profile.json", profile):
                return [TextContent(type="text", text=f"✅ Removed career aspiration: {aspiration}")]
            return [TextContent(type="text", text=f"❌ Failed to remove career aspiration")]
        
        else:
            logger.warning(f"Unknown tool requested: {name}")
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    
    except Exception as e:
        logger.error(f"Tool error in {name}: {str(e)}", exc_info=True)
        return [TextContent(type="text", text=f"Error: {str(e)}")]

async def main():
    """Main entry point using stdio transport"""
    logger.info("main() started")
    try:
        logger.info("Starting stdio_server")
        async with stdio_server() as (read_stream, write_stream):
            logger.info("stdio_server started, running server...")
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options()
            )
            logger.info("Server run completed")
    except Exception as e:
        logger.error(f"Error in main: {str(e)}", exc_info=True)
        raise

if __name__ == "__main__":
    logger.info("Script started")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server interrupted")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}", exc_info=True)
        sys.exit(1)
