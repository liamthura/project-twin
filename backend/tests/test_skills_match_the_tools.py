"""The shipped agent skills must describe tools that actually exist.

skills/README.md promises these are versioned with the tool surface they
describe. That promise is worth nothing unless something checks it -- a skill
naming a retired tool is worse than no skill, because an agent will believe it
and the user will never see why their persona stopped being updated.
"""
import re
from pathlib import Path

import pytest

import sections
import server

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"
SKILL_FILES = sorted(SKILLS_DIR.rglob("*.md"))

# Anything shaped like one of our tool names, so a retired one is caught by the
# same sweep that catches a typo.
_TOOL_RE = re.compile(
    r"\b(get_context|get_raw|search_context|get_entity|get_schema"
    r"|persona_modify|persona_batch|propose_update|suggest_persona_update"
    r"|analyze_message_for_capture)\b"
)


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_the_skills_are_actually_shipped():
    assert SKILL_FILES, f"no skills found under {SKILLS_DIR}"
    names = {p.parent.name for p in SKILL_FILES if p.name == "SKILL.md"}
    assert {"mygist", "mygist-reading", "mygist-writing", "mygist-capture"} <= names


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.name and str(p.parent.name))
def test_every_tool_a_skill_names_exists(path):
    for tool in sorted(set(_TOOL_RE.findall(_text(path)))):
        assert hasattr(server, tool), (
            f"{path.relative_to(SKILLS_DIR.parent)} names '{tool}', which the "
            "server does not expose"
        )


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.name and str(p.parent.name))
def test_every_scope_a_skill_names_is_valid(path):
    valid = set(sections.all_scope_names())
    for scope in re.findall(r"`(minimal|professional|personal|learning|full)`", _text(path)):
        assert scope in valid, f"{path.name} names scope '{scope}'"


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.name and str(p.parent.name))
def test_skill_frontmatter_is_well_formed(path):
    if path.name != "SKILL.md":
        return
    text = _text(path)
    assert text.startswith("---\n"), f"{path} has no frontmatter"
    frontmatter = text.split("---", 2)[1]
    name = re.search(r"^name:\s*(\S+)", frontmatter, re.M)
    assert name, f"{path} frontmatter has no name"
    assert name.group(1) == path.parent.name, (
        f"{path} declares name '{name.group(1)}' but sits in '{path.parent.name}'"
    )
    assert re.search(r"^description:\s*\S", frontmatter, re.M), (
        f"{path} frontmatter has no description -- that is what a client "
        "matches on to decide whether to load the skill"
    )


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.name and str(p.parent.name))
def test_relative_links_between_skills_resolve(path):
    for link in re.findall(r"\]\((?!https?:)([^)#]+)\)", _text(path)):
        assert (path.parent / link).resolve().exists(), (
            f"{path.name} links to '{link}', which does not exist"
        )
