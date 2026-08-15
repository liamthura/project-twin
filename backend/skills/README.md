# MyGist agent skills

Four skills that make an agent's use of MyGist consistent: the same reading
discipline, the same write boundary, the same judgement about what is worth
proposing, whichever client the user is in.

| Skill | Covers |
|---|---|
| [`mygist`](mygist/SKILL.md) | Entry point: the three rules, and where to go for each |
| [`mygist-reading`](mygist-reading/SKILL.md) | Scope selection, search-before-dump, using preferences |
| [`mygist-writing`](mygist-writing/SKILL.md) | Which write tool, entity vocabulary, identifiers, advisories |
| [`mygist-capture`](mygist-capture/SKILL.md) | What is worth proposing: sarcasm, aspiration, venting, third-party facts |

## Installing

These ship inside the Docker image, so a running server already serves them over
MCP as resources:

```text
skill://mygist/mygist/SKILL.md
skill://mygist/mygist-reading/SKILL.md
skill://mygist/mygist-writing/SKILL.md
skill://mygist/mygist-capture/SKILL.md
skill://index.json
```

A client that reads MCP resources can fetch them with no install at all, and the
server's own instructions point at them. The three MCP prompts (`catch_up`,
`whats_on_file`, `log_learning`) each tell the agent to read the skill they
depend on first.

To install them as files instead, they are plain Markdown. Copy them where your
client looks:

```bash
# Claude Code, for one project
mkdir -p .claude/skills && cp -r backend/skills/mygist* .claude/skills/

# Claude Code, everywhere
mkdir -p ~/.claude/skills && cp -r backend/skills/mygist* ~/.claude/skills/
```

For clients without a skills mechanism, paste
[`mygist/SKILL.md`](mygist/SKILL.md) into the system prompt or project
instructions. It is the shortest thing that changes behaviour, and it links to
the rest.

## What belongs in a skill

### The tool docstrings are the contract

They are all a plain MCP client ever sees, so anything an agent strictly needs in
order to call a tool correctly lives there: arguments, required fields, return
shapes.

### Skills carry the judgement a docstring cannot

When a scope is too wide. Why "I'm terrible at CSS" is not a skill level. When to
leave a record alone. The cases where the right call depends on reading the room.

Keeping that line matters: a skill that restates the API is a second copy of the
contract, and the two will drift the first time a signature changes. If you are
tempted to document a parameter here, put it in the docstring instead.

## Versioning

These live in the repository so they are versioned with the tool surface they
describe. When a tool's behaviour changes, the skill changes in the same commit,
which is the rule the docs site follows too.

`backend/tests/test_skills_match_the_tools.py` enforces the part that can be
checked mechanically: every tool name any of these files mentions has to exist on
the server, and every relative link between them has to resolve.
