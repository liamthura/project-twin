# MyGist

> _Formerly "Project Twin" / "Persona MCP"_

Your portable personal context for AI — stop repeating yourself.

**📖 [Documentation](https://mygist.thuradev.qzz.io/docs)** —
[Using MyGist](https://mygist.thuradev.qzz.io/docs/use) to connect a client and
edit your persona, [Running MyGist](https://mygist.thuradev.qzz.io/docs/run) to
host your own.

The docs site is the single source of truth. This file is deliberately an
overview and duplicates nothing from it, so it cannot fall out of date the way a
copied table or file tree does.

## Why this exists

Every new AI conversation starts from nothing. You re-explain your role, your
stack, how you like answers written, what you are working on. MyGist stores that
once and serves it to any client that speaks
[MCP](https://modelcontextprotocol.io), so the context travels with you instead
of living in one vendor's memory.

Your persona is structured JSON in your own Postgres — readable, exportable, and
editable by hand or through the web UI. Nothing is inferred behind your back:
MCP tools are passive and run only when a client calls them.

## What it does

- **Scoped reads.** A client asks for `minimal` or `professional` rather than
  pulling everything, with topic filters and a titles-only mode.
- **Lean retrieval.** `search_context` returns ranked snippets with ids;
  `get_entity` fetches only the ones that matter. Postgres full-text plus
  optional pgvector, degrading to FTS-only rather than breaking.
- **Structured writes.** A published entity vocabulary (`get_schema`) across ten
  persona sections, with duplicate advisories on add.
- **Proposals, not guesses.** Agents propose durable changes with their
  reasoning and a quote from you; nothing reaches your persona until you approve
  it, and anything you reject is never raised again.
- **OAuth or a token.** A client that speaks OAuth connects with nothing but the
  URL, through a consent screen where you choose what it may do. Anything
  without a browser uses a scoped bearer token instead.
- **Extensible sections.** A new persona section is one declarative manifest —
  no backend or frontend code. See
  [docs/CONTRIBUTING-PACKS.md](docs/CONTRIBUTING-PACKS.md).
- **Skills that make agents consistent.** Four Markdown skills in
  [`skills/`](skills/) covering how to read a persona, which write tool is
  correct, and what is worth proposing — so behaviour does not depend on which
  client you happen to be in.

## Quick start

```bash
docker build -t mygist .
docker run -p 1120:1120 -e DATABASE_URL="postgresql://…" mygist
```

One image serves the web UI at `/`, the REST API at `/api`, the MCP endpoint at
`/mcp`, and the documentation at `/docs`. Sign-in runs in a second container.

Then register an account and point your client at `http://127.0.0.1:1120/mcp`.
[Quick start](https://mygist.thuradev.qzz.io/docs/use/quick-start) walks through
it; [Self-hosting](https://mygist.thuradev.qzz.io/docs/run/self-hosting) covers
the second container and every environment variable that does something.

## Working on it

[Development](https://mygist.thuradev.qzz.io/docs/run/development) has the
repository layout, the commands for each part, and what CI checks. The short
version:

```bash
cd backend && docker compose up -d && python -m pytest -q
```

## Roadmap

- [ ] Better auto-triggering (waiting on MCP client improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning

## License

TBD — currently private
