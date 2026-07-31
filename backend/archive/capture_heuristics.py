"""MyGist's first capture pipeline. Retired 2026-07-31, kept as a record.

This decided what was worth remembering by matching substrings against
hand-written English word lists: ~90 technology names in KNOWN_SKILLS, 15
business terms in KNOWN_CONCEPTS, and a set of trigger idioms. It could not
see Datadog, which sat in knowledge.json at 'advanced' the whole time it ran,
and IGNORE_PATTERNS discarded any message containing "ok" or "explain" before
any other analysis ran.

Replaced by propose_update, where the calling agent -- which has already read
the conversation, knows the referents, and holds the persona -- authors the
proposal, and the server validates and persists it instead of guessing.

Imported by nothing. Excluded from test collection. Do not revive; read
docs/superpowers/specs/2026-07-31-proposal-inbox-design.md for why.
"""
import json
import re
from datetime import datetime

from persona_store import get_all as get_all_persona_data


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
    # Phase 5 (consolidation): passion/curiosity suggestions now emit entity
    # "interest" (kind-tagged) -- one threshold covers both former kinds.
    "interest": {"auto": 0.71, "ask": 0.48},
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
        # Phase 5 (consolidation): passion/curiosity suggestions now emit
        # entity "interest" (kind-tagged); dislike suggestions still emit
        # entity "dislike" but the shared list moved to likes_dislikes (the
        # emitter's data has no "name" key, so this lookup is unreachable
        # for dislike either way -- kept pointed at the real list for
        # documentation/hygiene, not because it fires).
        "interest": ("lifestyle", "interests"),
        "personality_trait": ("lifestyle", "personality_traits"),
        "dislike": ("preferences", "likes_dislikes"),
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
                            "action": "add", "entity": "goal",
                            "data": {"title": goal, "type": "career"},
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
                        "action": "add", "entity": "interest",
                        "data": {"name": item, "kind": "passion"},
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
                        "action": "add", "entity": "interest",
                        "data": {"name": item, "kind": "curiosity"},
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


