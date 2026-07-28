"""Schema coverage for the `ui` block: meta_schema.json must give it teeth
(reject unknown kinds, reject unknown keys on a section node) while still
accepting the legacy flat map third-party packs use, and every in-repo
manifest must actually validate.

Two very different completeness checks live below. They are easy to confuse,
so read this before touching either.

`entities` is a TOOL CONTRACT: the vocabulary an MCP client may pass to
`persona_modify`. `ui` is a STORAGE BINDING: the keys the renderer reads and
writes on the stored JSON. They are deliberately allowed to diverge, because
`execute_modify` in server.py normalises input aliases before writing --
`get_field(data, "name", "person", "contact", "connection_name")` accepts four
spellings and persists exactly one. A `ui` block naming a key nothing ever
writes renders a control whose edits vanish: a silent, permanent, unreadable
write.

1. `test_ui_field_names_are_spelled_like_the_entity_vocabulary` (was
   `test_ui_fields_are_covered_by_the_entity`) checks `ui` field names against
   `entity.required + entity.optional`. That is a SPELLING check and nothing
   more. It is wrong in BOTH directions as a phantom-key guard:

   - It ACCEPTS MCP-only input aliases. `contact` sits in `circle`'s
     `connection.optional`, so a `ui` block declaring `contact` -- the exact
     trap described above -- passes this check green.
   - It REJECTS legitimate storage keys the entity vocabulary does not carry.
     `timestamp` is written by server.py on every `learning_entry` add but is
     absent from `entities.learning_entry`; that is the only reason
     `display_fields` sits outside the check (see `_SUBSET_CHECKED_KEYS`).

   Because of the second direction, packs whose manifest names deliberately
   diverge from their storage keys must DECLARE the divergence per node via
   `fields_outside_entity`. They are not dropped from a hand-maintained pack
   list -- that is precisely how a divergent pack gets quietly omitted to keep
   a suite green. Packs are discovered from disk.

2. `test_shipped_ui_blocks_name_no_mcp_input_alias` is the guard that actually
   points at phantoms. It uses `FIELD_ALIASES` from server.py as a real,
   verified authority: for the entities that table names, exactly one spelling
   is persisted and the rest are input-only. See `CANONICAL_STORED_KEY`.

Neither check can cover everything. There is no authority on storage keys in
this repo -- nothing enumerates what `execute_modify`'s 37 hand-written
branches write -- so a `ui` field that is neither in the entity vocabulary nor
in an alias list is unguarded. Closing that needs such an authority to exist
first.

Both checks work per node and both need `node.entity` to have anything to
check against, so a node without one is SKIPPED WHOLESALE by both -- every
field it names is unguarded. That is `kind: "fields"` and `kind: "strings"`
nodes, which bind top-level storage keys (profile's name/bio/location) against
no entity vocabulary at all. `kind: "list"` nodes are the ones that must never
slip through this way, so meta_schema.json requires `entity` on them -- the
renderer tolerates its absence, which would otherwise turn a whole editable
node into a blind spot at exactly the point this module exists to cover. The
tests below re-assert that rather than trusting the schema alone.

The reject/accept tests below build their own manifests (based on the `goals`
shape) rather than depending on what's currently on disk, so they exercise the
schema regardless of whether the real manifests have been migrated to the
explicit `ui.sections` form yet.
"""
import copy
import json

import pytest

import pack_loader

# ---------------------------------------------------------------------------
# The storage-key authority, such as it is.
#
# `FIELD_ALIASES[entity]` in server.py is a list of spellings `get_field`
# accepts for that entity's identifier. `get_field` returns the first one
# present and `execute_modify` writes the result under ONE key -- so at most
# one member of each list is ever persisted, and every other member is
# input-only.
#
# The brief for this guard assumed the persisted key is always element 0.
# It is NOT: verified branch by branch against `execute_modify` in server.py,
# that convention holds for 9 of the 16 entries and breaks for 5 (two of them
# entities wave 4 migrates), with 2 more storing bare strings under no key at
# all. So the persisted key is recorded explicitly here rather than derived
# from list position. Each entry was read off the write in the named branch.
#
#   value = the key `execute_modify` persists the identifier under
#   None      = nothing in the list is ever persisted (the branch stores a
#               bare string, or forwards to another entity under a key the
#               list does not contain)
#
# Everything in FIELD_ALIASES[entity] other than this value is an input alias
# and must never appear in a `ui` block.
CANONICAL_STORED_KEY = {
    # first element is the stored key (the assumed convention holds)
    "name": "name",              # normalize_data writes normalized["name"]
    "hobby": "name",             # execute_modify `hobby`: {"id":..., "name": name, ...}
    "project": "name",           # execute_modify `project`: {"id":..., "name": name, ...}
    "domain": "name",            # execute_modify `domain`: {"id":..., "name": name, ...}
    "language": "name",          # execute_modify `language`: {"name": name, "fluency": ...}
    "email": "address",          # execute_modify `email`: {"address": address, ...}
    "link": "url",               # execute_modify `link`: {"url": url, "label": label}
    "passion": "name",           # forwards to `interest` as {"name": name, "kind": ...}
    "connection": "name",        # execute_modify `connection`: {"id":..., "name": name}
    # convention BROKEN -- stored key is not element 0
    "curiosity": "name",         # list starts "topic"; forwards to `interest` as {"name": ...}
    "mental_tab": "title",       # list starts "name"; stores {"title": topic, ...}
    "top_of_mind": "idea",       # list starts "topic"; stores {"idea": item, "note": ...}
    # nothing in the list is persisted
    "value": None,               # lifestyle["values"] is a list of bare strings
    "trait": None,               # lifestyle["personality_traits"] is a list of bare strings
    "aspiration": None,          # `career_aspiration` forwards to `goal` as {"title": ...}
    "learning_item": None,       # `current_learning` forwards to `goal` as {"title": ...}
}

# `ui` node keys the spelling check looks at. Deliberately narrow.
#
# `display_fields` is EXCLUDED on purpose, not by oversight: it names storage
# keys that are machine-written and therefore absent from the tool contract --
# `learning_log` displays `timestamp`, which server.py stamps on every add and
# which `entities.learning_entry` does not list. Including it here would fail
# a correct manifest.
#
# Be precise about what that costs, because it is easy to over-read: the alias
# check does inspect `display_fields`, but it only ever fires on entities
# `FIELD_ALIASES` names, and it can only ever flag a name that appears in that
# entity's alias list. `learning_entry` is not in `FIELD_ALIASES` at all, so
# `learning_log`'s `timestamp` -- the example above -- is checked by NOTHING.
# It is correct today because someone read server.py. Treat a `display_fields`
# binding as unverified unless you have read the write path yourself.
#
# `long_text`, `date_fields`, `sort.field`, `field_defaults`, `enum`,
# `suggestions` and `optional` sit outside the spelling check and are
# unguarded by it on the same terms. Guarding any of them properly needs an
# authority on what `execute_modify` writes, which this repo does not have.
_SUBSET_CHECKED_KEYS = ("badges", "detail_fields", "array_fields")

BASE_GOALS_MANIFEST = {
    "key": "goals",
    "title": "Goals",
    "description": "What you're working toward",
    "core": False,
    "position": 15,
    "defaults": {"goals": []},
    "id_lists": [["goals", "goal"]],
    "entities": {
        "goal": {
            "actions": ["add", "update", "remove"],
            "required": ["title"],
            "optional": ["type", "custom_type", "status", "target_date", "why", "notes"],
            "identifier": "title",
        }
    },
}


def _manifest_with_ui(ui):
    m = copy.deepcopy(BASE_GOALS_MANIFEST)
    m["ui"] = ui
    return m


def _load(key):
    path = pack_loader.PACKS_DIR / key / "manifest.json"
    return json.loads(path.read_text())


def _on_disk_pack_keys():
    return sorted(
        p.name
        for p in pack_loader.PACKS_DIR.iterdir()
        if p.is_dir() and (p / "manifest.json").exists()
    )


def _walk_sections(sections):
    """Yield every ui section node, including nested `children`."""
    for node in sections or []:
        yield node
        yield from _walk_sections(node.get("children"))


def _packs_with_ui_sections():
    """Every in-repo pack shipping an explicit `ui.sections` block, discovered
    from disk. Never a hand-maintained list: a pack that diverges from the
    entity vocabulary declares that per node (`fields_outside_entity`) and
    stays in the check, rather than disappearing from a constant."""
    keys = []
    for key in _on_disk_pack_keys():
        ui = _load(key).get("ui") or {}
        if isinstance(ui, dict) and ui.get("sections"):
            keys.append(key)
    return keys


PACKS_WITH_UI_SECTIONS = _packs_with_ui_sections()


def _fields_named_by(node):
    """Every storage key a ui node names, across all of its field-naming
    constructs. Used by the alias check, which -- unlike the spelling check --
    is sound for machine-written keys too, so it covers `display_fields`."""
    named = set()
    for list_key in ("fields", "badges", "detail_fields", "array_fields",
                     "date_fields", "long_text", "optional", "display_fields"):
        named |= set(node.get(list_key) or [])
    for map_key in ("suggestions", "enum", "field_defaults", "display_formats"):
        named |= set((node.get(map_key) or {}).keys())
    if node.get("title_field"):
        named.add(node["title_field"])
    sort_field = (node.get("sort") or {}).get("field")
    if sort_field:
        named.add(sort_field)
    return named


def ui_fields_that_are_aliases(entity, named):
    """Names in `named` that are MCP input aliases for `entity` rather than the
    key `execute_modify` persists.

    Returns an empty set for entities `FIELD_ALIASES` does not cover -- the
    table is the only authority available, so absence of an entry means "not
    known to be a phantom", never "verified safe"."""
    from server import FIELD_ALIASES

    aliases = FIELD_ALIASES.get(entity)
    if aliases is None:
        return set()
    alias_only = set(aliases) - {CANONICAL_STORED_KEY[entity]}
    return set(named) & alias_only


def test_every_in_repo_manifest_validates():
    packs = pack_loader.load_packs()
    # load_packs() swallows invalid manifests as warnings, so assert the
    # full on-disk set was actually loaded -- a schema regression that
    # rejects a manifest would otherwise silently shrink this set.
    on_disk = [k for k in _on_disk_pack_keys() if not k.startswith("_")]
    assert set(packs) == set(on_disk)
    for key, manifest in packs.items():
        pack_loader.validate_manifest(copy.deepcopy(manifest))  # must not raise

    # `_template` itself is excluded from `on_disk`/`packs` above (leading
    # underscore, never loaded by load_packs()) but it's the exact shape
    # third-party authors copy to start a new pack. If it drifts out of
    # schema unnoticed, every pack cloned from it fails validation and is
    # silently skipped by load_packs() -- so validate it directly here too.
    pack_loader.validate_manifest(_load("_template"))  # must not raise


def test_unknown_kind_is_rejected():
    manifest = _manifest_with_ui(
        {"sections": [{"kind": "grid", "path": ["goals"], "entity": "goal"}]}
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_list_node_missing_path_is_rejected():
    manifest = _manifest_with_ui({"sections": [{"kind": "list", "entity": "goal"}]})
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_list_node_with_empty_path_is_rejected():
    """`path: []` on a LIST node is a data-loss bug, not an empty section.

    An empty path addresses the containing object itself, so `setAt(x, [],
    value)` returns `value` -- it replaces `x` wholesale. For a top-level list
    that discards the section's entire stored object on the first write; for a
    child list (whose path resolves against the row's item) the first added
    child replaces the parent item, taking its `id`, its title and every other
    field with it. `Array.isArray([])` is true, so neither renderNode's guard
    nor ListRenderer's catches it -- the schema is the only place this can be
    stopped.

    Deliberately conditional on `kind`, NOT a blanket `minItems: 1` on `path`:
    `kind: "fields"` uses `path: []` to address the section root, which is how
    profile's top-level scalars are bound. That blanket constraint existed
    once and was removed in wave 2 for exactly that reason -- see
    `test_fields_node_with_empty_path_is_accepted`, which is the other half of
    this pair and fails if the constraint is ever re-widened.
    """
    top_level = _manifest_with_ui(
        {"sections": [{"kind": "list", "path": [], "entity": "goal"}]}
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(top_level)

    # `children` $refs uiSection, so the same rule must reach a nested list.
    nested = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "children": [{"kind": "list", "path": [], "entity": "goal"}],
                }
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(nested)


def test_list_node_missing_entity_is_rejected():
    """A list node binds editable controls to stored keys. `entity` is what
    both guards in this module resolve those keys against, and the renderer
    happily renders without one (falling back to node-level
    field_defaults/enum/optional), so an author who omits it gets a working
    section whose field names nothing checks. Rejected at authoring time."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "title_field": "title",
                    "detail_fields": ["notes"],
                }
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_missing_entity_error_names_entity():
    """`$defs.ui` is a `oneOf`: a list node missing `entity` fails BOTH
    branches (the explicit-sections branch via the `if`/`then` above, and the
    legacy-flat-map branch because a manifest with `sections` at all doesn't
    match that shape either), so the naive "first error sorted by path" picks
    the top-level `oneOf` failure at `ui`, which just dumps the whole block
    ("... is not valid under any of the given schemas") and never says what's
    actually wrong. A third-party author told to "fix until the log is clean"
    (docs/CONTRIBUTING-PACKS.md) needs the message to actually name the
    missing key, not just the block it's in."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "title_field": "title",
                    "detail_fields": ["notes"],
                }
            ]
        }
    )
    with pytest.raises(pack_loader.PackError, match="entity"):
        pack_loader.validate_manifest(manifest)


def test_fields_and_strings_nodes_may_omit_entity():
    """The converse: only `list` requires it. A `fields` node names top-level
    keys and a `strings` node names none, so neither has an entity to bind."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {"kind": "fields", "path": [], "fields": ["name"]},
                {"kind": "strings", "path": ["tags"]},
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_unknown_key_on_section_node_is_rejected():
    manifest = _manifest_with_ui(
        {
            "sections": [
                {"kind": "list", "path": ["goals"], "entity": "goal", "surprise": True}
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_fields_node_with_empty_path_is_accepted():
    """The spec's mechanism for a section's top-level scalars (profile's
    name/bio/location): `kind: "fields"` with `path: []` and a `fields` list.
    Before this fix, `fields` had no schema property (rejected as an unknown
    key) and `path`'s `minItems: 1` rejected the empty path outright."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "fields",
                    "path": [],
                    "fields": ["name", "preferred_name"],
                    "long_text": ["bio"],
                }
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_fields_node_with_nonempty_path_is_accepted():
    manifest = _manifest_with_ui(
        {"sections": [{"kind": "fields", "path": ["contact"], "fields": ["email"]}]}
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_malformed_enum_is_rejected():
    """node.enum must have the same shape as entity.valid_values
    (`{field: [string, ...]}`), not bare `{"type": "object"}` -- a scalar
    value there validates and crashes EnumControl's `options.map` at
    runtime."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "enum": {"stance": "love"},
                }
            ]
        }
    )
    with pytest.raises(pack_loader.PackError):
        pack_loader.validate_manifest(manifest)


def test_well_formed_enum_is_accepted():
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "enum": {"stance": ["love", "like", "avoid"]},
                }
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_legacy_flat_ui_map_is_still_accepted():
    manifest = _manifest_with_ui(
        {
            "goals": {
                "title_field": "title",
                "badges": ["type", "status"],
                "detail_fields": ["target_date", "why", "notes"],
            }
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


def test_declared_divergence_is_accepted_by_the_schema():
    """`fields_outside_entity` is the per-node opt-out from the spelling
    check. It has to validate, or a divergent pack's only way to stay green is
    to be dropped from the check entirely."""
    manifest = _manifest_with_ui(
        {
            "sections": [
                {
                    "kind": "list",
                    "path": ["goals"],
                    "entity": "goal",
                    "detail_fields": ["notes", "created_at"],
                    "fields_outside_entity": ["created_at"],
                }
            ]
        }
    )
    pack_loader.validate_manifest(manifest)  # must not raise


# ---------------------------------------------------------------------------
# Storage-key guards
# ---------------------------------------------------------------------------


def test_canonical_stored_key_covers_every_alias_entity():
    """Fail-closed against server.py drift. A new `FIELD_ALIASES` entry has an
    unknown write path until someone reads the branch, so it must land here
    before the alias guard will run -- unlike a pack list, forgetting this
    breaks the suite rather than silently shrinking it."""
    from server import FIELD_ALIASES

    assert set(CANONICAL_STORED_KEY) == set(FIELD_ALIASES), (
        "FIELD_ALIASES changed: verify the new/removed entity's write path in "
        "execute_modify and update CANONICAL_STORED_KEY"
    )


def test_the_first_element_convention_is_not_assumed():
    """Documents, executably, why CANONICAL_STORED_KEY exists instead of
    `FIELD_ALIASES[entity][0]`. If these entries are ever brought into line
    with the convention, this test fails and the map can be simplified."""
    from server import FIELD_ALIASES

    assert FIELD_ALIASES["mental_tab"][0] == "name"
    assert CANONICAL_STORED_KEY["mental_tab"] == "title"  # stored key, index 3
    assert FIELD_ALIASES["top_of_mind"][0] == "topic"
    assert CANONICAL_STORED_KEY["top_of_mind"] == "idea"  # not in the list at all
    assert FIELD_ALIASES["curiosity"][0] == "topic"
    assert CANONICAL_STORED_KEY["curiosity"] == "name"  # stored key, index 4


def test_ui_may_not_name_an_mcp_input_alias():
    """One member of FIELD_ALIASES[entity] is the stored key; the rest are
    input aliases that execute_modify resolves and never persists. A ui block
    naming one would render a control writing a key nothing reads.

    Synthetic, so it does not depend on a shipped pack staying wrong, but
    asserted against the real FIELD_ALIASES so it cannot drift from source."""
    from server import FIELD_ALIASES

    aliases = FIELD_ALIASES["connection"]
    assert CANONICAL_STORED_KEY["connection"] == "name", (
        "canonical key moved; this guard needs updating"
    )
    assert "contact" in aliases, "contact is no longer an alias; pick another"

    offenders = ui_fields_that_are_aliases(
        entity="connection",
        named={"name", "relationship", "contact"},
    )
    assert offenders == {"contact"}


def test_ui_alias_check_is_inert_for_unknown_entities():
    """Absence from FIELD_ALIASES means "no authority", not "safe". Stated as a
    test so the limitation is not mistaken for coverage."""
    assert ui_fields_that_are_aliases(entity="media_item", named={"anything"}) == set()


def test_every_manifest_with_ui_sections_is_discovered():
    """If discovery silently returned nothing, the parametrized checks below
    would generate zero cases and the suite would stay green -- the exact
    failure mode a hand-maintained pack list has."""
    with_ui = {k for k in _on_disk_pack_keys() if _load(k).get("ui")}
    discovered = set(PACKS_WITH_UI_SECTIONS)
    legacy_flat = {k for k in with_ui if not (_load(k)["ui"] or {}).get("sections")}
    assert discovered, "no manifest with a ui.sections block was discovered"
    assert discovered | legacy_flat == with_ui
    assert not (discovered & legacy_flat)


@pytest.mark.parametrize("key", PACKS_WITH_UI_SECTIONS)
def test_shipped_ui_blocks_name_no_mcp_input_alias(key):
    """The real guard: no shipped ui node binds a control to a name that
    `execute_modify` resolves as input and never writes."""
    manifest = _load(key)
    for node in _walk_sections(manifest["ui"]["sections"]):
        entity = node.get("entity")
        if not entity:
            # A `fields`/`strings` node has no entity, so this check has
            # nothing to resolve aliases against and skips it wholesale --
            # see module docstring. A `list` node must never reach here: it
            # binds editable controls, and skipping it would make this guard
            # silently inert on the node it exists for. meta_schema.json
            # rejects that shape; asserted again so the test does not depend
            # on the schema staying strict.
            assert node.get("kind") != "list", (
                f"{key}: a list node bound to path {node.get('path')} declares "
                f"no entity, so every field it names is unchecked"
            )
            continue
        offenders = ui_fields_that_are_aliases(entity, _fields_named_by(node))
        assert not offenders, (
            f"{key}: ui node for entity '{entity}' names {sorted(offenders)}, "
            f"which execute_modify accepts as input but never stores "
            f"(it writes '{CANONICAL_STORED_KEY[entity]}'). Edits to that "
            f"control would be written to a key nothing reads."
        )


@pytest.mark.parametrize("key", PACKS_WITH_UI_SECTIONS)
def test_ui_field_names_are_spelled_like_the_entity_vocabulary(key):
    """A SPELLING check, not a phantom-key guard -- see module docstring for
    both directions it gets wrong. ui -> entity only. Not reversed: `goals`
    declares `custom_type` in `optional` with no `ui` reference, which is the
    documented `custom_*` overflow mechanism, not an omission.

    A node whose field names deliberately diverge from the entity vocabulary
    declares exactly which names diverge via `fields_outside_entity`."""
    manifest = _load(key)
    entities = manifest["entities"]
    sections = manifest["ui"]["sections"]
    assert sections, f"{key}: ui.sections is empty -- nothing to check"
    checked_any = False
    for node in _walk_sections(sections):
        entity_key = node.get("entity")
        if not entity_key:
            # No entity means no vocabulary to compare against, so the node is
            # skipped wholesale -- see module docstring. A `list` node must
            # never take this branch; meta_schema.json rejects that shape.
            assert node.get("kind") != "list", (
                f"{key}: a list node bound to path {node.get('path')} declares "
                f"no entity, so every field it names is unchecked"
            )
            continue
        assert entity_key in entities, (
            f"{key}: ui node binds entity '{entity_key}' which the manifest "
            f"does not declare"
        )
        checked_any = True
        entity = entities[entity_key]
        known = set(entity["required"]) | set(entity["optional"])
        named = set()
        for list_key in _SUBSET_CHECKED_KEYS:
            named |= set(node.get(list_key) or [])
        if node.get("title_field"):
            named.add(node["title_field"])

        declared = set(node.get("fields_outside_entity") or [])
        stale = declared - named
        assert not stale, (
            f"{key}: fields_outside_entity declares {sorted(stale)}, which this "
            f"ui node does not name"
        )
        redundant = declared & known
        assert not redundant, (
            f"{key}: fields_outside_entity declares {sorted(redundant)}, which "
            f"entity '{entity_key}' already carries -- drop it, or a later real "
            f"divergence hides behind it"
        )

        missing = named - known - declared
        assert not missing, (
            f"{key}: ui names field(s) {sorted(missing)} not on entity "
            f"'{entity_key}'. If those are real storage keys the tool contract "
            f"does not carry, declare them in this node's fields_outside_entity."
        )
    if not checked_any:
        # A pack whose sections are all `fields`/`strings` legitimately has no
        # entity to check against (profile's top-level scalars are that
        # shape). Any other kind reaching here means nodes were checked by
        # nothing, which is what this assertion is for.
        kinds = sorted({node.get("kind") for node in _walk_sections(sections)})
        assert all(k in ("fields", "strings") for k in kinds), (
            f"{key}: no ui node bound an entity, so nothing was checked, and "
            f"the section kinds present are {kinds}"
        )
