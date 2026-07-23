# Contributing a Section Pack

A section pack adds a new persona section to MyGist with **one file** — no
backend code. The loader validates every pack at boot against
`backend/section_packs/meta_schema.json`; an invalid pack is skipped with a
warning (the server still boots).

## Steps

1. Copy `backend/section_packs/_template/` to `backend/section_packs/<key>/`
   where `<key>` is your section key (lowercase, snake_case). The manifest's
   `"key"` must equal the directory name.
2. Edit `manifest.json`:
   - `defaults` — the empty skeleton blob for the section.
   - `id_lists` — `[list_field, id_prefix]` pairs; every listed field must
     exist in `defaults` as a list. Prefixes must be unique across all packs.
   - `entities` — the write schema (actions, required/optional fields,
     enum `valid_values`, the `identifier` field used for update/remove).
     Entity names must be unique across all packs.
   - `scope_contributions` — which fields each global scope
     (minimal/professional/personal/learning/full) pulls from this section.
     Omit a scope to stay out of it; the section always gets its own scope
     token for free.
   - `capture_triggers` — phrases that hint `suggest_persona_update`.
   - `ui` — how the generic web editor renders each list: `title_field`,
     `badges` (fields shown as chips), `detail_fields`, and optional
     `suggestions` (preset values rendered as tap-to-add chips).
3. Boot the server (`python main.py`) — a schema violation is logged as a
   warning naming your pack; fix until the log is clean.
4. Run the tests: `python -m pytest tests/test_pack_loader.py -q`.
5. Open a PR containing exactly one new directory under
   `backend/section_packs/`.

## Rules

- Packs are declarative only — community packs cannot ship Python.
- New packs default **off**; users enable them in the Sections manager.
- Keep entries small: every field you add costs context tokens for every
  user who enables the pack. MyGist is a context provider — describe the
  person, don't manage their tasks.
