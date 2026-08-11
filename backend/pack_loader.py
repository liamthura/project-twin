"""Loader for declarative section packs (backend/section_packs/*/manifest.json).

Each pack is one manifest validated against meta_schema.json. Cross-pack
collisions (duplicate entity names or id prefixes) raise PackError because they
are packaging bugs, not user data — and so, since wave 11, does an invalid
manifest in the packs this repo ships, via load_packs(strict=True) from
manifests(). Warn-and-skip survives as the non-strict default, for a pack
directory the server does not own. sections.py and server.py build their
registry/entity-schema views from manifests() — this module must not import
either of them (they import us).
"""
import json
import logging
from pathlib import Path

import jsonschema
from jsonschema.exceptions import best_match

logger = logging.getLogger(__name__)

PACKS_DIR = Path(__file__).parent / "section_packs"
META_SCHEMA_PATH = PACKS_DIR / "meta_schema.json"
# Format v2, in flight. Nothing shipped validates against it yet -- it is reached
# only from validate_manifest_v2, which only the tests call until the cutover
# replaces META_SCHEMA_PATH with it. See
# docs/superpowers/plans/2026-08-11-manifest-format-v2.md.
META_SCHEMA_V2_PATH = PACKS_DIR / "meta_schema.v2.json"

# Mirrors sections.SCOPES keys; asserted equal in tests to prevent drift.
GLOBAL_SCOPE_NAMES = frozenset({"minimal", "professional", "personal", "learning", "full"})


class PackError(Exception):
    """A manifest is invalid or two packs collide."""


_meta_validator = None
_meta_validator_v2 = None


def _validator() -> jsonschema.Draft202012Validator:
    global _meta_validator
    if _meta_validator is None:
        schema = json.loads(META_SCHEMA_PATH.read_text())
        _meta_validator = jsonschema.Draft202012Validator(schema)
    return _meta_validator


def _validator_v2() -> jsonschema.Draft202012Validator:
    global _meta_validator_v2
    if _meta_validator_v2 is None:
        schema = json.loads(META_SCHEMA_V2_PATH.read_text())
        _meta_validator_v2 = jsonschema.Draft202012Validator(schema)
    return _meta_validator_v2


def validate_manifest(manifest: dict) -> None:
    """Schema + intra-pack cross-reference checks. Raises PackError."""
    error = best_match(_validator().iter_errors(manifest))
    # best_match descends into a `oneOf`/`anyOf` branch's own errors instead of
    # reporting the top-level "not valid under any of the given schemas" --
    # e.g. a `ui` list node missing `entity` fails both `$defs.ui` branches, so
    # the plain-first-by-path error used to name `ui` and dump the whole block
    # without ever saying `entity` is what's missing. This is purely about
    # which error is reported; it changes nothing about what validates.
    if error is not None:
        where = "/".join(str(p) for p in error.path) or "<root>"
        raise PackError(f"manifest schema violation at {where}: {error.message}")

    defaults = manifest["defaults"]
    for list_key, _prefix in manifest["id_lists"]:
        if not isinstance(defaults.get(list_key), list):
            raise PackError(
                f"id_lists references '{list_key}' which is not a list in defaults"
            )
    for scope in manifest.get("scope_contributions", {}):
        if scope not in GLOBAL_SCOPE_NAMES:
            raise PackError(f"unknown scope '{scope}' in scope_contributions")


def validate_manifest_v2(manifest: dict) -> None:
    """Format v2: schema validation. Raises PackError.

    Nothing shipped is in v2 yet, so nothing but the tests calls this. It becomes
    `validate_manifest` at the cutover, at which point the two collapse into one.

    The semantic rules JSON Schema cannot state live in `_cross_check`, called
    from here AFTER schema validation so a shape error is always reported before
    a semantic one -- a cross-check reading a malformed node reports a confusing
    consequence of the real mistake. Two rules the spec listed as cross-checks
    turned out to be statable structurally and live in the schema instead:
    `values` iff `type: "enum"`, and `item` iff `type: "list"`.
    """
    error = best_match(_validator_v2().iter_errors(manifest))
    # Same reason as validate_manifest: best_match descends into the branch's own
    # errors rather than reporting "not valid under any of the given schemas".
    # The v2 node dispatcher is allOf/if/then on `kind` for the same purpose --
    # a node whose kind is `list` is measured against the list branch alone, so
    # the error names the offending key rather than dumping the node four times.
    if error is not None:
        where = "/".join(str(p) for p in error.path) or "<root>"
        raise PackError(f"manifest schema violation at {where}: {error.message}")

    _cross_check(manifest)


# Keys of a field descriptor that the derived entity schema is built from. Rule 8
# compares two declarations of one entity over THESE and nothing else, so the
# check means exactly "the derived entity is the same either way" -- which lets
# two nodes over one entity differ in `title`, `placeholder`, `show` or
# `$comment` (lifestyle's weekday/weekend sleep pair differs in title and
# $comment alone) while still rejecting a divergence that would make the
# derivation silently pick one of two answers.
_DERIVED_FIELD_KEYS = (
    "name",
    "type",
    "values",
    "default",
    "required",
    "role",
    "alias",
    "exclusive",
    "allow_custom",
    "write_only",
    "item",
)


def _derivation_signature(item: dict) -> str:
    """A canonical form of everything `build_entity_schema` reads from an item."""

    def field_sig(field: dict) -> dict:
        out = {}
        for key in _DERIVED_FIELD_KEYS:
            if key not in field:
                continue
            out[key] = _derivation_signature(field[key]) if key == "item" else field[key]
        return out

    return json.dumps(
        {
            "identifier": item.get("identifier"),
            "actions": item.get("actions"),
            "description": item.get("description"),
            "variants": item.get("variants"),
            "fields": [field_sig(f) for f in item.get("fields", [])],
        },
        sort_keys=True,
    )


def _cross_check(manifest: dict) -> None:
    """The semantic rules of format v2. Raises PackError naming the pack and node.

    Every rule here describes a mistake that is SILENT in v1, and silent for the
    same reason in each case: the two halves of the rule lived in different
    blocks. `facets: ["level"]` sat on the node while `level`'s vocabulary sat in
    the entity's `valid_values`, so no single reader ever saw both. v2 puts them
    in one declaration, which is what makes them checkable at all.

    Numbering follows the spec's list of eleven. Rules 4 and 5, and "pin only on
    a bool field" (half of 7), are enforced by the schema. Rule 11 (`key` equals
    the directory name) belongs to `load_packs`, the only caller that knows the
    directory.
    """
    pack = manifest["key"]
    seen_entities: dict[str, tuple[str, str]] = {}  # name -> (signature, where)

    def fail(where: str, message: str) -> None:
        raise PackError(f"{pack}: {where}: {message}")

    def label(node: dict) -> str:
        return node.get("title") or ".".join(node.get("path") or []) or node["kind"]

    def claim_entity(name: str, signature: str | None, where: str) -> None:
        """Rule 8, scoped. The spec said entity names are unique across a pack, but
        `lifestyle` declares `sleep` on two `fields` nodes and today's single
        `sleep` entity serves both. So: a name may be declared twice only if both
        declarations derive the SAME entity. A variant passes signature=None,
        because a variant is a bare name and can never agree with anything."""
        if name not in seen_entities:
            seen_entities[name] = (signature, where)
            return
        prior_signature, prior_where = seen_entities[name]
        if signature is None or prior_signature is None or signature != prior_signature:
            fail(
                where,
                f"entity '{name}' is already declared at {prior_where} and the two "
                f"declarations do not agree, so the derived entity would depend on "
                f"which node was read last",
            )

    def check_item(item: dict, where: str, *, is_list_row: bool) -> None:
        fields = item["fields"]

        # Rule 6, first half: one stored key per field.
        names: dict[str, dict] = {}
        for field in fields:
            name = field["name"]
            if name in names:
                fail(where, f"two fields share the name '{name}'")
            names[name] = field

        # Rule 6, second half. Checked after every name is known, so a collision
        # is caught wherever the two fields sit relative to each other.
        claimed_aliases: dict[str, str] = {}
        for field in fields:
            for alias in field.get("alias", []):
                if alias in names:
                    fail(
                        where,
                        f"field '{field['name']}' declares the alias '{alias}', which "
                        f"is already the stored name of another field in this item",
                    )
                if alias in claimed_aliases:
                    fail(
                        where,
                        f"fields '{claimed_aliases[alias]}' and '{field['name']}' both "
                        f"declare the alias '{alias}'",
                    )
                claimed_aliases[alias] = field["name"]

        # Rule 2. A list row must have a title; a `fields` node is one record with
        # no collapsed row for a title to name, so for it the rule is at-most-one.
        titled = [f["name"] for f in fields if f.get("role") == "title"]
        if len(titled) > 1:
            fail(where, f"fields {titled} all carry role 'title'; exactly one may")
        if is_list_row and not titled:
            fail(where, "no field carries role 'title', so a row would have no name")

        # Rule 1.
        identifier = item.get("identifier")
        if identifier is not None and identifier not in names:
            fail(where, f"identifier '{identifier}' names no declared field")

        # Rule 7, second half. The schema already confines `pin` to a bool field.
        pinned = [f["name"] for f in fields if "pin" in f]
        if len(pinned) > 1:
            fail(where, f"fields {pinned} all declare `pin`; at most one may")

        # Rule 8.
        claim_entity(item["entity"], _derivation_signature(item), where)
        for variant in item.get("variants", []):
            claim_entity(variant["entity"], None, f"{where} (variant)")

        # Descend into nested lists, or every nested list is unchecked -- which is
        # most of profile.
        for field in fields:
            if "item" in field:
                check_item(field["item"], f"{where} > {field['name']}", is_list_row=True)

        return names

    top_level_lists: set[str] = set()

    def visit(nodes: list, trail: str) -> None:
        for node in nodes:
            where = f"{trail}{label(node)}"
            kind = node["kind"]
            if kind == "group":
                visit(node["sections"], f"{where} > ")
                continue
            if kind == "strings":
                continue
            if kind == "fields":
                check_item(node, where, is_list_row=False)
                continue
            # list
            if len(node["path"]) == 1:
                top_level_lists.add(node["path"][0])
            names = check_item(node["item"], where, is_list_row=True)
            # Rule 3. `facets` needs a closed vocabulary to build its chips from,
            # which is what makes the enum requirement more than pedantry.
            for facet in node.get("facets", []):
                if facet not in names:
                    fail(where, f"facet '{facet}' names no declared field")
                if names[facet].get("type") != "enum":
                    fail(where, f"facet '{facet}' is not an enum field, so it has no values to filter by")
            if "sort" in node and node["sort"]["field"] not in names:
                fail(where, f"sort field '{node['sort']['field']}' names no declared field")

    visit(manifest["sections"], "")

    # Rule 9. v1 checked only the `defaults` half, so an id_lists entry could name
    # a key with a seeded default and no editor at all.
    defaults = manifest["defaults"]
    for list_key, _prefix in manifest["id_lists"]:
        if not isinstance(defaults.get(list_key), list):
            raise PackError(
                f"{pack}: id_lists references '{list_key}' which is not a list in defaults"
            )
        if list_key not in top_level_lists:
            raise PackError(
                f"{pack}: id_lists references '{list_key}', which no top-level list node binds"
            )

    # Rule 10. These are top-level keys of the STORED FILE, selected for context
    # output at server.py:313 alongside `default.keys()` -- so `defaults` is the
    # authority, not the node tree. The spec said "paths that exist in the tree",
    # which no shipped pack satisfies: profile names `bio` and `current_role`
    # (fields of a `path: []` node, not nodes of their own) and lifestyle names
    # `wellness` (a storage prefix only a group sits over). A name that is in
    # neither place contributes nothing to context output, silently.
    for scope, keys in manifest.get("scope_contributions", {}).items():
        if scope not in GLOBAL_SCOPE_NAMES:
            raise PackError(f"{pack}: unknown scope '{scope}' in scope_contributions")
        for key in keys:
            if key not in defaults:
                raise PackError(
                    f"{pack}: scope_contributions['{scope}'] names '{key}', which is not "
                    f"a key in defaults, so it would contribute nothing"
                )


def load_packs(packs_dir: Path = PACKS_DIR, strict: bool = False) -> dict[str, dict]:
    """Scan packs_dir for <key>/manifest.json. Cross-pack collisions → PackError.
    Returns manifests ordered by (position, key).

    `strict` decides what an invalid pack means, and the two answers are for two
    different situations:

      strict=False (default) -- warn and skip. Right for a pack directory the
        server does not own: one bad third-party pack must not stop it booting.

      strict=True -- raise. Right for the packs shipped IN THIS REPO, where an
        invalid manifest is a packaging bug, not a runtime condition. `manifests()`
        passes it, so the real load is fatal.

    The default used to apply everywhere, and it hid two bugs. Wave 6 put
    `exclusive_fields` in the `uiSection` block instead of the `entity` block; the
    aesthetics pack was skipped, and the first anyone knew was "❌ Unknown entity
    type: aesthetic" much later. Wave 8 put `$comment` on an entity the meta-schema
    did not allow it on; that one surfaced at import only because `profile` is
    core, so sections._check_core raises on its absence. A non-core pack had no
    such backstop -- it simply ceased to exist, and every symptom appeared
    somewhere far from the cause.
    """
    _validator()  # fail loudly on a broken meta-schema, not as per-pack invalidity
    loaded: list[dict] = []
    for entry in sorted(packs_dir.iterdir()) if packs_dir.exists() else []:
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        path = entry / "manifest.json"
        if not path.exists():
            if strict:
                raise PackError(f"section pack {entry.name}: no manifest.json")
            logger.warning("section pack %s: no manifest.json — skipped", entry.name)
            continue
        try:
            manifest = json.loads(path.read_text())
            validate_manifest(manifest)
            if manifest["key"] != entry.name:
                raise PackError(
                    f"key '{manifest['key']}' does not match directory '{entry.name}'"
                )
        except (PackError, json.JSONDecodeError, OSError) as exc:
            if strict:
                raise PackError(f"section pack {entry.name}: invalid manifest — {exc}") from exc
            logger.warning("section pack %s: invalid manifest — skipped (%s)", entry.name, exc)
            continue
        loaded.append(manifest)

    seen_entities: dict[str, str] = {}
    seen_prefixes: dict[str, str] = {}
    for m in loaded:
        for entity in m["entities"]:
            if entity in seen_entities:
                raise PackError(
                    f"entity '{entity}' defined by both '{seen_entities[entity]}' and '{m['key']}'"
                )
            seen_entities[entity] = m["key"]
        for _list_key, prefix in m["id_lists"]:
            if prefix in seen_prefixes and seen_prefixes[prefix] != m["key"]:
                raise PackError(
                    f"id prefix '{prefix}' used by both '{seen_prefixes[prefix]}' and '{m['key']}'"
                )
            seen_prefixes[prefix] = m["key"]

    loaded.sort(key=lambda m: (m["position"], m["key"]))
    return {m["key"]: m for m in loaded}


_cache: dict | None = None


def manifests() -> dict[str, dict]:
    """Cached load of the real packs directory (call _reset_cache() in tests).

    strict=True: these are the packs this repo ships, so an invalid one is a
    packaging bug that must stop the process rather than quietly remove a
    section. See load_packs for the two bugs the lenient default hid.
    """
    global _cache
    if _cache is None:
        _cache = load_packs(PACKS_DIR, strict=True)
    return _cache


def _reset_cache() -> None:
    global _cache
    _cache = None


def build_entity_schema(packs: dict[str, dict]) -> dict[str, dict]:
    """{section_key: entities} in pack order — server.ENTITY_SCHEMA shape.

    `$comment` is dropped here rather than left to each reader. ENTITY_SCHEMA is
    what `get_schema` hands to MCP clients, so an authoring note left in it would
    be shipped as part of the tool contract — and the meta-schema promises the
    opposite: `description` is the client-facing text, `$comment` is for the next
    author. Nothing else is filtered; unknown keys are the pack's business.
    """
    return {
        key: {
            entity: {k: v for k, v in spec.items() if k != "$comment"}
            for entity, spec in m["entities"].items()
        }
        for key, m in packs.items()
    }
