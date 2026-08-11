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


def _fields_for(
    node: dict, pack: str, entity_name: str, entity: dict, entities: dict, bound: set
) -> list:
    """The field list, in reading order, from what the `ui` block RENDERS.

    Order: the form's own order first (`detail_fields`, or `fields` on a fields
    node), then anything appearing only on the collapsed row, then the nested
    arrays v1 kept in `children`, then the MCP-only names. Never
    `entity["optional"]` -- that is the set that would invent a control.
    """
    order = list(node.get("detail_fields") or node.get("fields") or [])
    title_field = node.get("title_field")
    if title_field and title_field not in order:
        order.insert(0, title_field)
    for key in ("badges", "display_fields", "count_badges", "array_fields"):
        for name in node.get(key) or []:
            if name not in order:
                order.append(name)
    # v1's `children` become fields of type list/strings, so their path names join
    # the field list at the point they were declared.
    children = {c["path"][-1]: c for c in node.get("children") or []}
    for name in children:
        if name not in order:
            order.append(name)
    # The pinned field appears in NO display array: v1's renderer drew it as the
    # star that claims the slot and excluded it from the form and the Add dialog.
    # Without this it never reached the field list, and `exclusive_fields` -- which
    # is derived from it -- vanished from the entity.
    pinned = (node.get("pinned") or {}).get("field")
    if pinned and pinned not in order:
        order.append(pinned)

    fields = [
        _descriptor(name, node, pack, entity_name, entity, entities, bound, children)
        for name in order
    ]
    fields += _mcp_only_fields(pack, entity_name, entity, order)
    return fields


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
    if name in (node.get("long_text") or []):
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
    return show or ["form"]


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
    parent_entity = entities.get((parent or {}).get("entity"), {})
    for name, spec in entities.items():
        if name in bound or _STRINGS_WRITERS.get((pack, name)) != array_name:
            continue
        if bool(spec.get("parent")) != bool(parent):
            continue
        if parent is not None and spec.get("parent") not in _parent_spellings(parent_entity, spec):
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


def _parent_spellings(parent_entity: dict, spec: dict) -> set:
    """Every spelling the enclosing row's identifier could be reported under. A
    reference says `domain_name` where the row's stored key is `name`, so matching
    on the identifier alone would find nothing."""
    return {spec.get("parent"), parent_entity.get("identifier")} - {None}


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


def _main(argv: list) -> int:
    check = "--check" in argv
    changed = []
    for directory in sorted(p for p in pack_loader.PACKS_DIR.iterdir() if p.is_dir()):
        path = directory / "manifest.json"
        v1 = json.loads(path.read_text())
        if "sections" in v1:
            continue  # already v2
        v2 = json.dumps(convert(v1), indent=2, ensure_ascii=False) + "\n"
        if v2 != path.read_text():
            changed.append(directory.name)
            if not check:
                path.write_text(v2)
    verb = "would rewrite" if check else "rewrote"
    print(f"{verb} {len(changed)} manifest(s): {', '.join(changed) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
