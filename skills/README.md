# MyGist agent skills

Four skills that make an agent's use of MyGist consistent — the same reading
discipline, the same write boundary, the same judgement about what is worth
proposing, whichever client the user is in.

| Skill | Covers |
|---|---|
| [`mygist`](mygist/SKILL.md) | Entry point: the three rules, and where to go for each |
| [`mygist-reading`](mygist-reading/SKILL.md) | Scope selection, search-before-dump, using preferences |
| [`mygist-writing`](mygist-writing/SKILL.md) | Which write tool, entity vocabulary, identifiers, advisories |
| [`mygist-capture`](mygist-capture/SKILL.md) | What is worth proposing — sarcasm, aspiration, venting, third-party facts |

## Installing

Skills are plain Markdown. Copy them where your client looks:

```bash
# Claude Code, for one project
mkdir -p .claude/skills && cp -r skills/mygist* .claude/skills/

# Claude Code, everywhere
mkdir -p ~/.claude/skills && cp -r skills/mygist* ~/.claude/skills/
```

For clients without a skills mechanism, paste
[`mygist/SKILL.md`](mygist/SKILL.md) into the system prompt or project
instructions. It is the shortest thing that changes behaviour, and it links to
the rest.

## What belongs in a skill, and what does not

**The tool docstrings are the contract.** They are all a plain MCP client ever
sees, so anything an agent strictly needs in order to call a tool correctly
lives there — arguments, required fields, return shapes.

**Skills carry the judgement a docstring cannot.** When a scope is too wide.
Why "I'm terrible at CSS" is not a skill level. When to leave a record alone.
The cases where the right call depends on reading the room.

Keeping that line matters: a skill that restates the API is a second copy of
the contract, and the two will drift the first time a signature changes. If you
are tempted to document a parameter here, put it in the docstring instead.

## Keeping them honest

These ship in the repo so they are versioned with the tool surface they
describe. When a tool's behaviour changes, the skill changes in the same commit
— the same rule the docs site follows.
