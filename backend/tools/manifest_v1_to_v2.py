"""Convert a v1 section-pack manifest to format v2. Deterministic and re-runnable.

Run as a module to rewrite every manifest in place:

    python -m tools.manifest_v1_to_v2            # all packs, including _template
    python -m tools.manifest_v1_to_v2 --check    # print what would change, write nothing

The converted manifests are GENERATED OUTPUT, committed alongside this file so the
diff is reviewable and reproducible. Change the converter and re-run; never
hand-edit a converted manifest, or the next run silently reverts the edit.

The rule that matters most, and the one this file exists to get right: THE FIELD
LIST COMES ONLY FROM WHAT THE `ui` BLOCK RENDERS TODAY. It is never taken from an
entity's `required`/`optional`, because that set contains names no control is
bound to -- 13 of them across the packs -- and a converter that read it would put
about a dozen controls on screen that do not exist today. Those 13 are classified
by hand in `_MCP_ONLY` below, each as an `alias` of a real field or as
`write_only`, and `tests/test_converter.py` asserts none of them can render.
"""
import json
import sys
from pathlib import Path

import pack_loader

# The names an entity declares that NO control is bound to. Every one is placed by
# hand, because a default would either drop it from the contract or draw it on
# screen. Keyed by (pack, entity) where the name is ambiguous across packs.
#
# `alias`: an MCP input spelling for a field that IS rendered, under another name.
# `write_only`: in the contract, rendered nowhere, by design.
_MCP_ONLY = {
    # (pack, entity, mcp_name) -> the stored field it is an alias OF
    ("profile", "coursework", "course"): "name",
    ("knowledge", "domain_reference", "ref_name"): "name",
    ("lifestyle", "hobby_reference", "ref_name"): "name",
    ("projects", "project_reference", "ref_name"): "name",
    ("knowledge", "mental_tab_reference", "ref_name"): "name",
    ("projects", "top_of_mind", "item"): "idea",
}

# Names that render nowhere and alias nothing: in the contract, never on screen.
_WRITE_ONLY = {
    ("learning_log", "learning_entry"): ("conversation_metadata", "related_entries", "new_topic"),
    ("lifestyle", "sleep"): ("day_type",),
    ("profile", "link"): ("new_label",),
}

# Two entities whose storage path is computed at runtime, so no node shape implies
# them. They move to `mcp_entities` verbatim. See the `$comment` on that key in
# meta_schema.v2.json for why this list must not grow casually.
_QUARANTINE = {("knowledge", "knowledge"), ("preferences", "preference")}

_TOP_LEVEL_COPIED = (
    "$schema",
    "key",
    "title",
    "description",
    "core",
    "default_enabled",
    "position",
    "defaults",
    "id_lists",
    "scope_contributions",
)


def convert(v1: dict) -> dict:
    """v1 manifest -> v2 manifest. Pure; the input is never mutated."""
    pack = v1["key"]
    entities = v1.get("entities", {})
    out = {k: v1[k] for k in _TOP_LEVEL_COPIED if k in v1}

    bound: set[str] = set()
    sections = [_node(n, pack, entities, bound, parent=None) for n in v1["ui"]["sections"]]
    out["sections"] = sections

    # Variants: an entity no node binds, whose contract is identical to a bound
    # one except for its description. `dislike` over `like`, `coursework_topic`
    # over `coursework`. Detected rather than listed, so a third one is picked up
    # automatically instead of being dropped.
    _attach_variants(sections, pack, entities, bound)

    quarantined = {
        name: {k: v for k, v in spec.items()}
        for name, spec in entities.items()
        if (pack, name) in _QUARANTINE
    }
    if quarantined:
        out["mcp_entities"] = quarantined
    return out


# --- nodes ----------------------------------------------------------------


def _node(node: dict, pack: str, entities: dict, bound: set, parent: dict | None) -> dict:
    kind = node["kind"]
    out = {"kind": kind}
    if kind != "group":
        out["path"] = list(node["path"])
    for key in ("title", "description", "info"):
        if key in node:
            out[key] = node[key]

    if kind == "group":
        out["sections"] = [_node(c, pack, entities, bound, parent) for c in node["sections"]]
        _carry_comment(out, node, entities, None)
        return out

    if kind == "strings":
        if node.get("item_control"):
            # v1 spelled the default "tag"; v2 spells it "chips", which is what
            # ArrayInput renders. No pack declares the default, so nothing maps to it.
            out["control"] = "chips" if node["item_control"] == "tag" else node["item_control"]
        if "placeholder" in node:
            out["placeholder"] = node["placeholder"]
        writer = _strings_writer(pack, entities, node["path"][-1], parent, bound)
        if writer:
            out["element"] = writer
        _carry_comment(out, node, entities, None)
        return out

    entity_name = node["entity"]
    entity = entities.get(entity_name, {})
    bound.add(entity_name)
    fields = _fields_for(node, pack, entity_name, entity, entities, bound)

    if kind == "fields":
        element = {"entity": entity_name}
        if entity.get("identifier"):
            element["identifier"] = entity["identifier"]
        if entity.get("actions") and list(entity["actions"]) != ["update"]:
            element["actions"] = list(entity["actions"])
        if "description" in entity:
            element["description"] = entity["description"]
        element["fields"] = fields
        out["element"] = element
        _carry_comment(out, node, entities, entity_name)
        return out

    # list
    if node.get("searchable"):
        out["search"] = True
    for key in ("facets", "sort"):
        if key in node:
            out[key] = node[key]
    element = {"entity": entity_name, "identifier": _stored_identifier(node, entity)}
    if entity.get("actions") and list(entity["actions"]) != ["add", "update", "remove"]:
        element["actions"] = list(entity["actions"])
    if "description" in entity:
        element["description"] = entity["description"]
    if "list" in entity:
        element["list"] = entity["list"]
    element["fields"] = fields
    out["element"] = element
    _carry_comment(out, node, entities, entity_name)
    return out


def _stored_identifier(node: dict, entity: dict) -> str:
    """The identifier as a STORED key, which is what `element.identifier` means.

    v1's entity spelled it however MCP clients say it -- `domain_reference`'s is
    `ref_name` while the stored key is `name` -- so copying the entity's spelling
    would name a field that does not exist. The derivation maps it back through
    `alias[0]`, which is how the contract keeps saying `ref_name`.
    """
    return node.get("title_field") or entity.get("identifier") or ""


def _carry_comment(out: dict, node: dict, entities: dict, entity_name: str | None) -> None:
    """v1 put authoring notes on the node AND on the entity. v2 has one place per
    node, so the two are joined -- nothing is dropped, and `item` has no `$comment`
    of its own precisely so there is only ever one place to look."""
    parts = [node["$comment"]] if "$comment" in node else []
    if entity_name and "$comment" in entities.get(entity_name, {}):
        parts.append(f"On the entity: {entities[entity_name]['$comment']}")
    if parts:
        out["$comment"] = " ".join(parts)


# --- the field list -------------------------------------------------------


# Transcribed from ScalarField.jsx:16's `LONG_TEXT_FIELDS = new Set(["notes",
# "why", "description"])`. Ten shipped v1 nodes render a textarea for one of
# these names WITHOUT declaring `long_text` at all -- the renderer's fallback
# supplies it by name whenever the node says nothing. v1 could get away with
# that because the heuristic and the manifest lived in the same runtime; v2
# states a field's type once, on the field, so the heuristic has to be
# transcribed into the conversion INSTEAD of carried forward as a second,
# undeclared source of truth in the renderer. See fieldMeta.js's `fromDescriptors`,
# which deliberately does NOT re-add this fallback -- a name heuristic there
# would silently override a future field that is genuinely `type: "text"` and
# happens to be called `notes`. This dict is where the heuristic dies: every
# converted manifest says `type: "longtext"` outright, and nothing downstream
# ever again decides "is this long text" by looking at a field's name.
_LONG_TEXT_NAME_HEURISTIC = frozenset({"notes", "why", "description"})


def _check_long_text_agreement(node: dict, order: list, pack: str) -> None:
    """The heuristic above only applies when the node declares NO `long_text`
    at all -- `node.long_text ? new Set(node.long_text) : LONG_TEXT_FIELDS` in
    ScalarField.jsx is a fork on PRESENCE, not on whether the name is covered.
    So a node that declares `long_text` and ALSO renders an undeclared
    `notes`/`why`/`description` field would have the two rules disagree about
    that one field -- the declaration says plain text, the name heuristic
    says textarea. No shipped manifest does this (checked by hand across
    every pack before writing this function), and this raises rather than
    silently picking a side if a future manifest ever does.
    """
    declared = node.get("long_text")
    if declared is None:
        return
    undeclared = (set(order) & _LONG_TEXT_NAME_HEURISTIC) - set(declared)
    if undeclared:
        raise ValueError(
            f"{pack}/{node.get('title') or node.get('path')}: declares long_text="
            f"{declared!r} but also renders undeclared field(s) {sorted(undeclared)} "
            "whose name matches the old ScalarField.jsx heuristic (notes/why/"
            "description) -- the declaration and the name heuristic disagree about "
            "whether these render as a textarea. Add them to long_text (or rename "
            "the field) before converting."
        )


def _fields_for(
    node: dict, pack: str, entity_name: str, entity: dict, entities: dict, bound: set
) -> list:
    """The field list, in reading order, from what the `ui` block RENDERS.

    v1 spelled a field's positions as half a dozen independent arrays, each with
    its own order. v2 has one array, so the ONE order it ships has to reproduce
    all of them -- `_reading_order` is where that is worked out. Never
    `entity["optional"]` -- that is the set that would invent a control.
    """
    # v1's `children` become fields of type list/strings, so their path names join
    # the field list at the point they were declared.
    children = {c["path"][-1]: c for c in node.get("children") or []}
    order = _reading_order(node, children, pack)
    _check_long_text_agreement(node, order, pack)

    fields = [
        _descriptor(name, node, pack, entity_name, entity, entities, bound, children)
        for name in order
    ]
    fields += _mcp_only_fields(pack, entity_name, entity, order)
    return fields


# The v1 node keys whose ORDER a reader can see: the form lays its controls out
# in `detail_fields` order, the row draws chips in `badges` / `count_badges`
# order, and the blocks under a row stack in `children` order. Each one becomes
# a set of "a before b" constraints on the single v2 field list.
_ORDERED_ARRAYS = ("badges", "display_fields", "count_badges")

# ...and the keys whose order nothing can see, because every renderer asks them
# `.includes(field)`. They contribute membership, not sequence -- imposing their
# order too would collide with the arrays above for no gain.
_MEMBERSHIP_KEYS = ("array_fields", "long_text", "date_fields", "time_fields", "bool_fields")

# Node-level maps. A name can appear in one of these and in NO display array --
# knowledge's `created_at` has a default and renders nowhere -- and dropping it
# would silently retire a write the bespoke editor still makes.
_MEMBERSHIP_MAPS = ("enum", "field_defaults", "field_placeholders", "suggestions",
                    "display_formats")

# Where a v1 node asks for two orders one field list cannot both keep, and which
# one gives way. Keyed by (pack, node title) and listed by hand, so that a
# future manifest with a new conflict raises instead of quietly reordering
# something on screen.
#
# profile/Education is the only shipped case: its `children` stack Highlights
# above Coursework, its `count_badges` chip Coursework before Highlights. The
# blocks win -- `children` is a deliberately sequenced array of whole nodes,
# where `count_badges` is a bag of names -- so Education's two chips swap. That
# is the single rendered difference in the whole conversion.
_ORDER_CONFLICTS = {("profile", "Education"): "count_badges"}


def _reading_order(node: dict, children: dict, pack: str) -> list:
    """One field order that reproduces every ordered v1 array."""
    form = list(node.get("detail_fields") or node.get("fields") or [])
    title_field = node.get("title_field")
    if title_field and title_field not in form:
        form.insert(0, title_field)

    yields = _ORDER_CONFLICTS.get((pack, node.get("title")))
    sequences = [form, list(children)] + [
        list(node.get(k) or []) for k in _ORDERED_ARRAYS if k != yields
    ]
    # Seeded in this order, so that where the constraints leave a choice the
    # result reads the way the section does: the form, then the blocks beneath
    # it, then the row's chips, then everything only the contract can see.
    seed = []
    for names in sequences + [list(node.get(k) or []) for k in _MEMBERSHIP_KEYS]:
        seed += names
    for key in _MEMBERSHIP_MAPS:
        seed += list(node.get(key) or {})
    # The pinned field appears in NO display array: v1's renderer drew it as the
    # star that claims the slot and excluded it from the form and the Add dialog.
    # Without this it never reached the field list, and `exclusive_fields` --
    # which is derived from it -- vanished from the entity.
    pinned = (node.get("pinned") or {}).get("field")
    if pinned:
        seed.append(pinned)

    rank: dict = {}
    for name in seed:
        rank.setdefault(name, len(rank))
    after = {name: set() for name in rank}
    blockers = dict.fromkeys(rank, 0)
    for names in sequences:
        for i, earlier in enumerate(names):
            for later in names[i + 1 :]:
                if later not in after[earlier]:
                    after[earlier].add(later)
                    blockers[later] += 1

    ready = sorted((n for n in rank if not blockers[n]), key=rank.get)
    order = []
    while ready:
        name = ready.pop(0)
        order.append(name)
        for later in after[name]:
            blockers[later] -= 1
            if not blockers[later]:
                ready.append(later)
        ready.sort(key=rank.get)
    if len(order) != len(rank):
        stuck = sorted(set(rank) - set(order))
        raise ValueError(
            f"cannot order the fields of {pack}/{node.get('title') or node.get('path')}: "
            f"its display arrays disagree about {stuck}. Decide which array gives "
            f"way and add it to _ORDER_CONFLICTS."
        )
    return order


def _descriptor(
    name: str,
    node: dict,
    pack: str,
    entity_name: str,
    entity: dict,
    entities: dict,
    bound: set,
    children: dict,
) -> dict:
    field: dict = {"name": name}

    child = children.get(name)
    ftype = _type_of(name, node, entity, child)
    if ftype != "text":
        field["type"] = ftype
    if ftype == "enum":
        field["values"] = list(
            (node.get("enum") or {}).get(name) or entity.get("valid_values", {}).get(name) or []
        )
        if f"custom_{name}" in entity.get("optional", []):
            # v1 said this with a magic `custom_` prefix in the entity's optional
            # list, which ScalarField matched on and nothing declared.
            field["allow_custom"] = True

    if _is_required(name, node, pack, entity_name, entity):
        field["required"] = True
    if node.get("title_field") == name:
        field["role"] = "title"

    show = _show_for(name, node)
    if show != ["form"]:
        field["show"] = show

    label = (node.get("field_labels") or {}).get(name)
    if label:
        field["label"] = label
    elif child is not None and child.get("title"):
        # v1 carried a nested list's human title on the child node; as a field it
        # needs a label or the name would be title-cased into "Coursework".
        field["label"] = child["title"]

    placeholder = (node.get("field_placeholders") or {}).get(name)
    if placeholder is None and child is not None:
        placeholder = child.get("placeholder")
    if placeholder:
        field["placeholder"] = placeholder

    suggestions = (node.get("suggestions") or {}).get(name)
    if suggestions:
        field["suggestions"] = list(suggestions)

    default = (node.get("field_defaults") or {}).get(name)
    if default is None:
        default = entity.get("field_defaults", {}).get(name)
    if default is not None:
        field["default"] = default

    fmt = (node.get("display_formats") or {}).get(name)
    if fmt:
        field["format"] = fmt

    alias = _alias_for(pack, entity_name, name, entity)
    if alias:
        field["alias"] = alias

    if name in entity.get("exclusive_fields", []):
        field["exclusive"] = True

    if _is_ui_only(name, field.get("alias") or [], entity):
        field["ui_only"] = True

    off = []
    if "values" in field and name not in entity.get("valid_values", {}):
        off.append("values")
    if "default" in field and name not in entity.get("field_defaults", {}):
        off.append("default")
    if off and not field.get("ui_only"):
        field["off_contract"] = off

    pinned = node.get("pinned")
    if pinned and pinned.get("field") == name:
        field["pin"] = {k: v for k, v in pinned.items() if k != "field"}
        # A pinned slot is claimed by a flag, and the star that claims it toggles a
        # boolean -- v1 left the type implicit in the renderer.
        field["type"] = "bool"
        # `pin` IS this field's rendering: v1 kept it out of the form and the Add
        # dialog and drew a star on every row instead. Saying `show: ["form"]` by
        # default would put a switch on screen that has never existed.
        field["show"] = ["pin"]

    if child is not None and child["kind"] == "strings":
        control = child.get("item_control")
        if control:
            field["control"] = "chips" if control == "tag" else control
    elif child is not None:
        field["element"] = _nested_element(child, pack, entities, bound)

    # A string array reaches v2 by two v1 routes -- a `children` node of kind
    # strings, and an `array_fields` entry -- and BOTH may have an MCP writer.
    # Looking only at the first missed projects' `tags` and `highlights`.
    if field.get("type") == "strings":
        writer = _strings_writer(pack, entities, name, node, bound)
        if writer:
            field["element"] = writer

    if "$comment" in (child or {}):
        field["$comment"] = child["$comment"]
    return field


def _nested_element(child: dict, pack: str, entities: dict, bound: set) -> dict:
    entity_name = child["entity"]
    entity = entities.get(entity_name, {})
    bound.add(entity_name)
    element = {"entity": entity_name, "identifier": _stored_identifier(child, entity)}
    if entity.get("actions") and list(entity["actions"]) != ["add", "update", "remove"]:
        element["actions"] = list(entity["actions"])
    if "description" in entity:
        element["description"] = entity["description"]
    if "parent" in entity:
        element["parent"] = entity["parent"]
    if "list" in entity:
        element["list"] = entity["list"]
    element["fields"] = _fields_for(child, pack, entity_name, entity, entities, bound)
    return element


def _type_of(name: str, node: dict, entity: dict, child: dict | None) -> str:
    if child is not None:
        return "strings" if child["kind"] == "strings" else "list"
    if name in (node.get("array_fields") or []):
        return "strings"
    # A declared `long_text` wins outright when the node has one -- even an
    # EMPTY declared list, because `[] ? x : y` is still the truthy branch in
    # JS, so `long_text: []` in a v1 node means "no field here is long text",
    # not "fall through to the name heuristic". Only the true ABSENCE of the
    # key (`node.get("long_text") is None`) falls through to the name
    # heuristic below -- see `_LONG_TEXT_NAME_HEURISTIC`'s comment for why
    # that heuristic has to be transcribed here at all.
    declared_long_text = node.get("long_text")
    if declared_long_text is not None:
        if name in declared_long_text:
            return "longtext"
    elif name in _LONG_TEXT_NAME_HEURISTIC:
        return "longtext"
    if name in (node.get("date_fields") or []):
        return "date"
    if name in (node.get("time_fields") or []):
        return "time"
    if name in (node.get("bool_fields") or []):
        return "bool"
    if name in (node.get("enum") or {}) or name in entity.get("valid_values", {}):
        return "enum"
    return "text"


def _is_required(name: str, node: dict, pack: str, entity_name: str, entity: dict) -> bool:
    """Required as the ENTITY says, under either spelling, minus the parent's
    identifier -- which v1 lists in a nested entity's `required` but which is not a
    field of the row at all."""
    required = entity.get("required", [])
    spellings = {name, *_alias_for(pack, entity_name, name, entity)}
    if not (spellings & set(required)):
        return False
    return name != entity.get("parent")


def _is_ui_only(name: str, aliases: list, entity: dict) -> bool:
    """Rendered, stored, and in no MCP vocabulary -- the mirror of `write_only`.

    Derived, not listed: a rendered field that appears in neither `required` nor
    `optional` under any of its spellings is one. That is exactly the four
    server-written timestamps, because the six other names that look outside the
    vocabulary are there under an `alias` instead.

    An entity with no vocabulary at all (a node whose entity is missing) is not
    evidence of anything, so nothing is marked.
    """
    vocabulary = set(entity.get("required", [])) | set(entity.get("optional", []))
    if not vocabulary:
        return False
    return not ({name, *aliases} & vocabulary)


def _show_for(name: str, node: dict) -> list:
    show = []
    in_form = name in (node.get("detail_fields") or node.get("fields") or []) or node.get(
        "title_field"
    ) == name
    if in_form:
        show.append("form")
    if name in (node.get("badges") or []):
        show.append("badge")
    if name in (node.get("display_fields") or []):
        show.append("row")
    if name in (node.get("count_badges") or []):
        show.append("count")
    # No fallback to ["form"]. A name the node mentions ONLY in `field_defaults`
    # is stored and defaulted and drawn nowhere -- knowledge's `created_at` is
    # the one shipped case -- and defaulting it into the form would put a
    # control on screen that has never existed.
    return show


def _alias_for(pack: str, entity_name: str, name: str, entity: dict) -> list:
    """alias[0] is the spelling today's entity declares; later entries are the
    additional input spellings from server.py's FIELD_ALIASES."""
    aliases = []
    for (p, e, mcp_name), stored in _MCP_ONLY.items():
        if p == pack and e == entity_name and stored == name:
            aliases.append(mcp_name)
    return aliases


def _mcp_only_fields(pack: str, entity_name: str, entity: dict, rendered: list) -> list:
    """Names in the contract that render nowhere. Never inferred -- listed above."""
    out = []
    for name in _WRITE_ONLY.get((pack, entity_name), ()):
        field = {"name": name, "write_only": True}
        if name in entity.get("valid_values", {}):
            field["type"] = "enum"
            field["values"] = list(entity["valid_values"][name])
        if name in entity.get("required", []):
            field["required"] = True
        out.append(field)
    return out


# --- variants -------------------------------------------------------------


def _attach_variants(sections: list, pack: str, entities: dict, bound: set) -> None:
    """An entity no node binds, identical to a bound one but for its description,
    becomes a `variants` entry on that one. Detected rather than listed: `dislike`
    over `like` and `coursework_topic` over `coursework` are found the same way, so
    a third would be too instead of being silently dropped."""
    unbound = [n for n in entities if n not in bound and (pack, n) not in _QUARANTINE]
    if not unbound:
        return

    def comparable(spec: dict) -> str:
        return json.dumps(
            {k: v for k, v in spec.items() if k not in ("description", "$comment")},
            sort_keys=True,
        )

    by_shape: dict[str, str] = {}
    for name in bound:
        by_shape.setdefault(comparable(entities[name]), name)

    for name in unbound:
        host = by_shape.get(comparable(entities[name]))
        if host is None:
            continue
        element = _find_element(sections, host)
        if element is None:
            continue
        variant = {"entity": name}
        if "description" in entities[name]:
            variant["description"] = entities[name]["description"]
        element.setdefault("variants", []).append(variant)


def _find_element(nodes: list, entity_name: str) -> dict | None:
    for node in nodes:
        if node["kind"] == "group":
            found = _find_element(node["sections"], entity_name)
            if found:
                return found
            continue
        if node["kind"] == "fields":
            if node.get("element", {}).get("entity") == entity_name:
                return node["element"]
            continue
        element = node.get("element")
        if element is None:
            continue
        found = _find_in_element(element, entity_name)
        if found:
            return found
    return None


def _find_in_element(element: dict, entity_name: str) -> dict | None:
    if element.get("entity") == entity_name:
        return element
    for field in element.get("fields", []):
        nested = field.get("element")
        if nested is not None:
            found = _find_in_element(nested, entity_name)
            if found:
                return found
    return None


# --- strings writers ------------------------------------------------------


def _strings_writer(
    pack: str, entities: dict, array_name: str, parent: dict | None, bound: set
) -> dict | None:
    """The entity, if any, that MCP may use to write into this string array.

    v1 declared this NOWHERE: these entities existed only in the authored
    `entities` block, with nothing connecting `personality_trait` to the
    `personality_traits` array it writes. So the binding is recovered by matching
    the entity's shape -- `required` is [parent identifier?, identifier] and
    nothing else -- against the array's position in the tree. Eleven entities in
    the shipped packs bind this way, and the gate proves each one lands.
    """
    parent_entity_name = (parent or {}).get("entity")
    parent_entity = entities.get(parent_entity_name, {})
    for name, spec in entities.items():
        if name in bound or _STRINGS_WRITERS.get((pack, name)) != array_name:
            continue
        if bool(spec.get("parent")) != bool(parent):
            continue
        if parent is not None and spec.get("parent") not in _parent_spellings(
            parent_entity_name, parent_entity
        ):
            continue
        bound.add(name)
        element = {"entity": name, "identifier": spec["identifier"]}
        if list(spec.get("actions", [])) != ["add", "remove"]:
            element["actions"] = list(spec["actions"])
        if "description" in spec:
            element["description"] = spec["description"]
        if "parent" in spec:
            element["parent"] = spec["parent"]
        if array_name in spec.get("optional", []):
            element["bulk"] = True
        return element
    return None


def _parent_spellings(parent_entity_name: str | None, parent_entity: dict) -> set:
    """Every spelling the ENCLOSING ROW's identifier could be reported under.

    Two spellings are in use: the bare identifier (`education_highlight`'s parent
    is `institution`, which is `education`'s own identifier) and the identifier
    prefixed by the parent entity's name (`project_tag`'s parent is
    `project_name`, where `project`'s identifier is `name`). Both appear in the
    shipped packs, so matching on the bare identifier alone would find nothing
    for half of them.

    What must NOT be in this set is `spec["parent"]` itself. It was, and that made
    the caller's guard vacuous -- a value is trivially a member of a set built
    from it -- so the first entity in dict order won whenever two writers targeted
    the same array name. `profile`'s two `highlights` writers are exactly that
    case, and the result was Education's Highlights block declaring
    `work_highlight` while Work Experience's declared `education_highlight`. The
    swap was invisible because no renderer read the entity, and the contract gate
    could not see it either: both entities derive correctly whichever node they
    hang off, since their own spec supplies their `parent`.
    """
    identifier = parent_entity.get("identifier")
    if identifier is None:
        return set()
    spellings = {identifier}
    if parent_entity_name:
        spellings.add(f"{parent_entity_name}_{identifier}")
    return spellings


# Which string array each writer targets: (pack, entity) -> (array name, parent
# identifier or None). Transcribed from each entity's `required`/`parent` and
# confirmed against its execute_modify branch, because v1 recorded the binding in
# neither the node nor the entity -- only in a hardcoded branch.
#
# `bulk` is NOT listed here: it is read from whether the entity's `optional`
# already names the array. Only work_skill said so; work_highlight and
# project_highlight accept the plural too (server.py's `data.get("highlights", [])`
# in each branch's add), so v2 adds it for them -- an addition to the contract,
# recorded in the plan, never a removal.
_STRINGS_WRITERS = {
    ("profile", "work_highlight"): "highlights",
    ("profile", "education_highlight"): "highlights",
    ("profile", "work_skill"): "skills",
    ("projects", "project_tag"): "tags",
    ("projects", "project_highlight"): "highlights",
    ("lifestyle", "hobby_specific"): "specifics",
    ("lifestyle", "personality_trait"): "personality_traits",
    ("lifestyle", "value"): "values",
    ("lifestyle", "energy_peak"): "energy_peaks",
    ("lifestyle", "stress_trigger"): "stress_triggers",
    ("preferences", "response_format"): "response_format",
}


# --- entry point ----------------------------------------------------------


# The v1 manifests, frozen at the commit before the cutover overwrote them. The
# input has to live somewhere once `section_packs` holds the output: the plan
# requires manifests to stay GENERATED for the rest of its tasks -- change the
# converter, re-run, commit the result, never hand-edit -- and that is only true
# while this file exists. Keyed by DIRECTORY, not by `key`, because `_template`
# ships the key `example`.
V1_CORPUS = Path(__file__).resolve().parent.parent / "tests/fixtures/manifests_v1.json"


def v1_manifests() -> dict:
    """{directory_name: v1 manifest}. The converter's only input."""
    return json.loads(V1_CORPUS.read_text())


# `_template` stops being generated output at Task 11, which rewrote it BY HAND as
# the genuine minimum a pack can be -- one list node, three fields, nothing
# optional, and a `$comment` pointing at docs/CONTRIBUTING-PACKS.md. The converter
# still has a v1 `_template` in the corpus and still converts it (the tests below
# assert that its output validates and is idempotent, which is free coverage), but
# it must not WRITE it: converting a made-up demo pack produced a manifest full of
# keys a first-time author does not need, and re-running this file would revert the
# hand-written one silently while `--check` reported a diff nobody caused.
_NOT_GENERATED = {"_template"}


def _main(argv: list) -> int:
    check = "--check" in argv
    changed = []
    for name, v1 in sorted(v1_manifests().items()):
        if name in _NOT_GENERATED:
            continue
        path = pack_loader.PACKS_DIR / name / "manifest.json"
        v2 = json.dumps(convert(v1), indent=2, ensure_ascii=False) + "\n"
        if not path.exists() or v2 != path.read_text():
            changed.append(name)
            if not check:
                path.write_text(v2)
    verb = "would rewrite" if check else "rewrote"
    print(f"{verb} {len(changed)} manifest(s): {', '.join(changed) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
