# Contributing a Section Pack

A section pack adds a whole persona section to MyGist — storage, MCP write
vocabulary, read scopes, search indexing and editor UI — from **one file**:

```
backend/section_packs/<key>/manifest.json
```

No Python. No React. Packs are declarative only, which is what makes accepting
one from a stranger a reasonable thing to do.

## The documentation

This file is deliberately short. The full material lives on the docs site, which
is generated from and checked against the code:

| | |
|---|---|
| [Section packs](https://mygist.thuradev.qzz.io/docs/run/section-packs) | The walkthrough — a complete worked example, the guards you will meet, and the common mistakes |
| [Manifest reference](https://mygist.thuradev.qzz.io/docs/run/pack-reference) | Every key a manifest accepts, with a real example of each |

The authority above both is `backend/section_packs/meta_schema.json`. Set
`"$schema": "../meta_schema.json"` in your manifest and your editor will
validate it as you type.

Running the docs locally:

```bash
cd docs-site && npm install && npm run dev
```

## The short version

1. `cp -r backend/section_packs/_template backend/section_packs/<key>`
2. Edit `manifest.json`. The directory name, the file's `"key"`, and the
   section key must all agree.
3. Boot the server — `cd backend && python main.py`. An invalid manifest raises
   a `PackError` naming your pack and the offending key. Fix, repeat.
4. `python -m pytest -q` in `backend/`.
5. `npm run fixtures` in `frontend/` — `src/__fixtures__/packs.json` is
   generated from the manifests, and CI fails on a stale one.
6. Open a PR containing exactly one new directory under
   `backend/section_packs/`.

## An invalid pack stops the server

A manifest that violates `meta_schema.json` **raises and halts startup**. It is
not skipped with a warning.

That changed deliberately. Warn-and-skip meant a single mistyped key removed an
entire section silently: the pack vanished, and the first symptom appeared much
later and nowhere near the cause — a client being told an entity type was
unknown. It happened twice. Failing at boot puts the error where the mistake is.

Warn-and-skip survives only for pack directories the server does not own.

## Rules

- **Declarative only.** Community packs cannot ship Python or React. If
  something cannot be expressed in the manifest, that is a renderer-kit change,
  not a pack change.
- **New packs default off.** Set `default_enabled: false`; users opt in from the
  Sections manager. `core` is `false` for anything contributed.
- **Declare `list` on every entity.** The sole-id-list fallback has an ambiguity
  guard and declines entities rather than guessing. Omitting it is the most
  common reason a new pack's writes silently do nothing.
- **Names and prefixes are globally unique.** Entity names and id prefixes are
  unique across every pack, so a new pack cannot shadow an existing one.
- **Keep entries small.** Every field costs context tokens for every user who
  enables the pack. MyGist describes a person; it does not manage their tasks.
- **Comment non-obvious decisions.** Entities and UI nodes accept a `$comment`
  key, ignored by the loader and never shown to a client. The shipped packs use
  it heavily.

## Checklist

- [ ] Directory name, `key`, and the manifest filename agree
- [ ] `default_enabled: false`, `core: false`
- [ ] Every entity declares `list`
- [ ] Entity names and the id prefix are unique across all packs
- [ ] Scope contributions are as small as you can justify
- [ ] Every stored key is bound by a `ui` node, or excluded with a written
      reason
- [ ] `python -m pytest -q` passes in `backend/`
- [ ] `npm run fixtures` produces no diff in `frontend/`
- [ ] Exactly one new directory under `backend/section_packs/`
