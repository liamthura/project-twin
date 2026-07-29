# MyGist

> _Formerly "Project Twin" / "Persona MCP"_

Your portable personal context for AI — stop repeating yourself.

**📖 [Documentation](https://mygist.thuradev.qzz.io/docs)** — everything below in
depth, split into [Using MyGist](https://mygist.thuradev.qzz.io/docs/use) and
[Running MyGist](https://mygist.thuradev.qzz.io/docs/run).

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
  pulling everything — plus topic filtering and a titles-only mode.
- **Lean retrieval.** `search_context` returns ranked snippets with ids;
  `get_entity` fetches only the ones that matter.
- **Structured writes.** A published entity vocabulary (`get_schema`) covering
  ten persona sections, with duplicate advisories on add.
- **Hybrid search.** Postgres full-text plus optional pgvector embeddings,
  degrading to FTS-only rather than breaking.
- **A web editor** generated from the same section packs the server writes
  through, so the UI and the tool vocabulary cannot drift apart.
- **Extensible sections.** A new persona section is one declarative manifest —
  no backend or frontend code. See
  [docs/CONTRIBUTING-PACKS.md](docs/CONTRIBUTING-PACKS.md).

## Quick start

You need Postgres and one container.

```bash
docker build -t mygist .
docker run -p 8000:8000 -e DATABASE_URL="postgresql://…" mygist
```

That single image serves the web UI at `/`, the REST API at `/api`, the MCP
endpoint at `/mcp`, and the documentation at `/docs`.

Then register an account, create a token, and point your client at
`http://127.0.0.1:8000/mcp` with an `Authorization: Bearer` header — the
[quick start](https://mygist.thuradev.qzz.io/docs/use/quick-start) walks through
it.

## Repository layout

```
├── backend/          # FastAPI: REST API, MCP server, persona logic
│   ├── main.py         # entry point — /api, /mcp, static routes
│   ├── server.py       # MCP tools and persona writes
│   ├── section_packs/  # one manifest per persona section
│   ├── pack_loader.py  # manifest validation
│   └── scripts/        # migrations and search-index backfill
├── frontend/         # React SPA — the persona editor
├── docs-site/        # this project's documentation (Fumadocs, static export)
├── docs/             # internal specs, plans, and CONTRIBUTING-PACKS.md
└── mygist_data/      # legacy JSON personas — migration source only
```

## Development

```bash
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
docker compose up -d test-db
DATABASE_URL="postgresql://mygist:mygist@localhost:5433/mygist_test" uvicorn main:app --reload
```

```bash
cd frontend && npm install && npm run dev
```

Tests: `python -m pytest -q` in `backend/`, `npm test` in `frontend/`.

Static routes are conditional on built output existing, so a source checkout
serves the API and MCP normally with no UI and no docs.

## Documentation

The docs site is the single source of truth. This file is deliberately an
overview: it duplicates nothing, so it cannot fall out of date the way a copied
entity table does.

| | |
|---|---|
| [Using MyGist](https://mygist.thuradev.qzz.io/docs/use) | Connect a client, read and write your persona, capture |
| [Running MyGist](https://mygist.thuradev.qzz.io/docs/run) | Self-hosting, database, search index, section packs |

Building the docs locally:

```bash
cd docs-site && npm install && npm run dev
```

## Roadmap

- [ ] Better auto-triggering (waiting on MCP client improvements)
- [ ] Conversation history for pattern detection
- [ ] Data versioning

## License

TBD — currently private
