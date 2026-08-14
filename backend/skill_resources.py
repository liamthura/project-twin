"""Publishing the MyGist skills as MCP resources.

A skill is a markdown file that teaches an agent how to use this server well --
which scope to read, when to write versus propose, what a proposal needs. They
used to live only in one developer's ~/.claude/skills, which meant every other
client got the tool schemas and had to work the rest out.

Served at `skill://mygist/<name>/SKILL.md`, matching the shape Figma's MCP server
uses, so a client that already understands one understands this one.

Registered STATICALLY, one resource per file, rather than behind a
`skill://mygist/{name}/SKILL.md` template. Both resolve on read, but only a
static resource appears in `list_resources()` -- a template shows up in
`list_resource_templates()` and nowhere else. Since the entire point is that a
client can SEE what is on offer, a template alone would defeat it. Verified
against fastmcp 2.14.2, which is pinned; see the note in requirements.txt.

Not scope-gated. `mcp_scopes.py` filters the tool list per grant, and these are
deliberately outside that: a skill file is public documentation about how to call
an API. It holds no persona data, and a client that cannot read anybody's persona
still benefits from knowing how the tools work.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

SKILLS_DIR = Path(__file__).parent / "skills"

# The one place the URI shape is written down.
URI_PREFIX = "skill://mygist"
INDEX_URI = "skill://index.json"


@dataclass(frozen=True)
class Skill:
    """One skill on disk, with what the frontmatter says about it."""

    name: str
    description: str
    path: Path

    @property
    def uri(self) -> str:
        return f"{URI_PREFIX}/{self.name}/SKILL.md"


def parse_frontmatter(text: str) -> Dict[str, str]:
    """The `name` and `description` out of a SKILL.md's frontmatter block.

    Hand-rolled because there is no YAML dependency in requirements.txt and two
    flat keys do not justify adding one. Handles what these files actually
    contain and nothing more:

    - the block between the first two `---` lines, and only that
    - `key: value` split on the FIRST colon, because every real description
      contains at least one and splitting anywhere else truncates the text
      clients match against
    - a line it cannot read is skipped rather than guessed at

    Returns `{}` for a file with no frontmatter, which the caller treats as a
    mistake rather than a default.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}

    parsed: Dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        key, sep, value = line.partition(":")
        if not sep:
            continue
        key = key.strip()
        if key:
            parsed[key] = value.strip()
    return parsed


def discover() -> List[Skill]:
    """Every skill in `skills/`, sorted by name.

    Raises on a file whose frontmatter has no name or description. That is a
    packaging mistake, and the alternative -- publishing an unnamed resource that
    no client will ever match -- fails silently in production instead of loudly in
    the test suite.
    """
    found: List[Skill] = []
    for directory in sorted(SKILLS_DIR.iterdir()):
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            continue

        meta = parse_frontmatter(skill_file.read_text())
        name = meta.get("name")
        description = meta.get("description")
        if not name or not description:
            raise ValueError(
                f"{skill_file} needs both `name` and `description` in its "
                "frontmatter -- a resource without them cannot be matched by a "
                "client, so it would ship invisible."
            )
        # The directory name and the declared name have to agree, or the URI a
        # client is handed does not lead back to the file it names.
        if name != directory.name:
            raise ValueError(
                f"{skill_file} declares name={name!r} but sits in "
                f"{directory.name!r}; the URI is built from the declared name."
            )
        found.append(Skill(name=name, description=description, path=skill_file))
    return found


def _reader(body: str):
    """A zero-argument function returning `body`.

    A factory rather than the usual `def read(_body=body)` default-argument trick
    for binding a loop variable. FastMCP reads ANY function parameter as a URI
    template placeholder, so the default-argument version makes it try to build a
    ResourceTemplate from a URI with no `{}` in it, and registration fails.
    """

    def read() -> str:
        return body

    return read


def register(mcp) -> List[Skill]:
    """Attach one resource per skill, plus the index, to a FastMCP server.

    Returns what it registered, so a caller can log or assert on it.
    """
    skills = discover()

    for skill in skills:
        # Read now rather than at call time: the file ships inside the image and
        # cannot change under a running server, so reading here means a missing
        # or unreadable file fails at startup instead of on somebody's request.
        mcp.resource(
            skill.uri,
            name=skill.name,
            title=f"Skill: {skill.name}",
            description=skill.description,
            mime_type="text/markdown",
        )(_reader(skill.path.read_text()))

    index = {
        "skills": [
            {"name": s.name, "uri": s.uri, "description": s.description} for s in skills
        ]
    }
    index_body = json.dumps(index, indent=2)

    @mcp.resource(
        INDEX_URI,
        name="skill-index",
        title="MyGist skill index",
        description=(
            "Every MyGist skill, with its URI and what it is for. Fetch this "
            "rather than listing all resources if you only want the skills."
        ),
        mime_type="application/json",
    )
    def read_index() -> str:
        return index_body

    return skills
