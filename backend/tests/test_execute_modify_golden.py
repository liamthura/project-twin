"""What every entity's write path DOES today: the message, and the stored row.

`execute_modify` answers an MCP client in prose -- "✅ Added trait: Curious",
"❌ Work experience at 'Acme' not found" -- and that prose is the whole of what
the calling agent sees. Nothing asserted it. Ninety-seven message literals
across this suite check the leading ✅/❌/ℹ️ and nothing after it, so every
branch could be reworded, or quietly start storing a different shape, with the
suite green.

This is the gate for collapsing those branches onto the declarative write path.
It drives every entity in the vocabulary through the same script -- add, add
again, update, remove, remove again, plus an add with its required fields
missing -- and freezes BOTH halves of each answer: the exact string, and the
section blob afterwards.

Deliberately independent of the code it guards. The payloads are built by this
module's own walk of the manifests, not by pack_loader's derivation, so a bug
in that derivation cannot make the golden agree with itself. Nothing here
imports from the write path except to call it.

Regenerating is a deliberate act:

    GOLDEN_REGEN=1 python -m pytest tests/test_execute_modify_golden.py

Do it when a message or a stored shape is MEANT to change, and read the diff --
it is the change, stated in full. Regenerating to make a red test green is how
this stops being a gate.
"""
import json
import os
import re
from pathlib import Path

import pytest

import pack_loader
import server
import settings_store

FIXTURE = Path(__file__).parent / "fixtures" / "execute_modify_golden.json"
REGEN = os.environ.get("GOLDEN_REGEN") == "1"

# Written by the server on the way in, so they differ every run.
VOLATILE_KEYS = {"id", "entry_id", "added_date", "last_updated", "created_at",
                 "timestamp"}

# `related_entries` is the one field no generated value can satisfy: every link
# must resolve to an entity that already exists, so a made-up one is rejected
# before anything else in the payload is read, and the whole write would be
# recorded as that refusal. tests/test_relations.py owns this field.
NOT_GENERATED = {"related_entries"}


# ---------------------------------------------------------------------------
# The manifests, walked here rather than read from pack_loader's derivation.
# ---------------------------------------------------------------------------

def _walk(manifest):
    """{entity: descriptor} for every writable element in one manifest.

    descriptor: path to the list, the element's own fields with their declared
    types, and -- for a nested element -- how to reach the row it sits under.
    """
    found = {}

    def element(node_path, el, parent, kind):
        fields = []
        for f in el.get("fields", []) or []:
            fields.append({
                "name": f["name"],
                "param": f.get("alias", [f["name"]])[0] if f.get("alias") else f["name"],
                "type": f.get("type", "text"),
                "required": bool(f.get("required")),
                "values": f.get("values"),
                "ui_only": bool(f.get("ui_only")),
            })
        entry = {
            "path": node_path,
            "identifier": el.get("identifier"),
            "fields": fields,
            "parent": parent,
            "kind": kind,
        }
        for name in [el["entity"]] + [v["entity"] for v in el.get("variants", [])]:
            found[name] = entry
        # A nested array is an element of its own, hanging off this row.
        for f in el.get("fields", []) or []:
            child = f.get("element")
            if child is None:
                continue
            handle = {"path": node_path, "identifier": el.get("identifier"),
                      "param": child.get("parent", el.get("identifier")),
                      "child": f["name"]}
            if f.get("type") == "strings":
                found[child["entity"]] = {
                    "path": node_path, "identifier": child.get("identifier"),
                    "fields": [], "parent": handle, "kind": "strings",
                    "bulk": f["name"] if child.get("bulk") else None,
                }
            else:
                element(node_path, child, handle, "list")

    def visit(nodes):
        for node in nodes:
            if node["kind"] == "group":
                visit(node["sections"])
            elif node["kind"] == "strings":
                el = node.get("element")
                if el:
                    found[el["entity"]] = {
                        "path": node["path"], "identifier": el.get("identifier"),
                        "fields": [], "parent": None, "kind": "strings",
                        "bulk": node["path"][-1] if el.get("bulk") else None,
                    }
            else:
                element(node["path"], node["element"], None,
                        "fields" if node["kind"] == "fields" else "list")

    visit(manifest["sections"])
    return found


def _from_contract(section, entity, spec):
    """A descriptor for an entity declared in `mcp_entities`.

    Those two -- `knowledge` and `preference` -- are hand-written contract
    entries with no element behind them, so there is no tree to walk and no
    declared type: everything is text unless the contract names a vocabulary.
    """
    values = spec.get("valid_values", {})
    named = ([(n, True) for n in spec.get("required", [])]
             + [(n, False) for n in spec.get("optional", [])])
    # `category` locates the row for both of them -- knowledge stores under
    # domains[category] and preference under preferences[category][key] -- so
    # it has to stay put across add, update and remove exactly as an
    # identifier does, or every step after the add addresses a different place.
    fields = [{"name": n, "param": n, "type": "text", "required": req,
               "values": values.get(n), "ui_only": False,
               "locator": n == "category"} for n, req in named]
    return {"path": [], "identifier": spec.get("identifier"), "fields": fields,
            "parent": None, "kind": "list", "section": section}


def _descriptors():
    out = {}
    for key, manifest in pack_loader.manifests().items():
        if key.startswith("_"):
            continue
        for entity, desc in _walk(manifest).items():
            out[entity] = {**desc, "section": key}
    schema = pack_loader.build_entity_schema(pack_loader.manifests())
    for key, entities in schema.items():
        for entity, spec in entities.items():
            out.setdefault(entity, _from_contract(key, entity, spec))
    return out


DESCRIPTORS = _descriptors()
# Opt-in packs: execute_modify refuses a section the user has not enabled, and
# every entity here is meant to be exercised, not gated.
DEFAULT_OFF = {key for key, m in pack_loader.manifests().items()
               if not m.get("default_enabled", True)}
SCHEMA = pack_loader.build_entity_schema(pack_loader.manifests())
ENTITIES = sorted(
    (section, entity)
    for section, entities in SCHEMA.items()
    for entity in entities
)


# ---------------------------------------------------------------------------
# Payloads. Deterministic, and shaped by the declared type so the golden
# records real behaviour rather than the server's answer to a string sent
# where a list belongs.
# ---------------------------------------------------------------------------

def _value(field, pass_):
    """A stable value for one field. `pass_` picks a different one on update."""
    name, type_ = field["name"], field["type"]
    if field.get("values"):
        vals = field["values"]
        return vals[min(pass_, len(vals) - 1)]
    if type_ == "bool":
        return pass_ == 0
    if type_ == "date":
        return ["2026-03-01", "2026-09-30"][pass_]
    if type_ == "time":
        return ["07:30", "23:15"][pass_]
    if type_ == "strings":
        return [[f"{name}-one", f"{name}-two"], [f"{name}-three"]][pass_]
    if type_ == "list":
        return []
    return [f"{name} one", f"{name} two"][pass_]


def _payload(entity, desc, spec, pass_=0, skip_required=False):
    data = {}
    parent = desc.get("parent")
    if parent:
        data[parent["param"]] = "Parent Row"
    ident = spec.get("identifier")
    if ident and not desc["fields"]:
        # A bare-string element: the identifier IS the value, and it stays put
        # for the same reason a row's identifier does. Dropping it is what
        # "without required fields" means here -- there is nothing else to drop.
        if not skip_required:
            data[ident] = f"{entity} one"
        return data
    for field in desc["fields"]:
        if field["ui_only"] or field["name"] in NOT_GENERATED:
            continue
        if skip_required and field["required"]:
            continue
        if field.get("locator"):
            data[field["name"]] = f"{field['name']} one"
            continue
        stored = field["name"]
        param = stored
        if ident and stored == desc["identifier"]:
            # The identifier is how add, update and remove find the same row,
            # so it is the one field that does NOT change on the update pass.
            # It still has to be a legal value: lifestyle's sleep is identified
            # by an enum.
            data[ident] = field["values"][0] if field.get("values") else f"{entity} one"
            continue
        data[param] = _value(field, pass_)
    return data


def _seed_parent(desc):
    """Create the row a nested entity hangs under, by hand.

    Not through execute_modify: the parent's own write path is one of the
    things under test here, and a golden that seeded through it would fail
    twice for one change.
    """
    parent = desc["parent"]
    blob = server.load_json(f"{desc['section']}.json")
    node = blob
    for step in parent["path"][:-1]:
        node = node.setdefault(step, {})
    rows = node.setdefault(parent["path"][-1], [])
    rows.append({parent["identifier"]: "Parent Row"})
    server.save_json(f"{desc['section']}.json", blob)


def _scrub(value):
    """Strip what differs between two identical runs."""
    if isinstance(value, dict):
        return {k: ("<volatile>" if k in VOLATILE_KEYS and v else _scrub(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    if isinstance(value, str):
        # Ids reach the MESSAGE too -- a learning entry is confirmed by its id,
        # which carries the date it was logged on.
        value = re.sub(r"\blearn_\d{8}_[0-9a-f]{6}\b", "<id>", value)
        return re.sub(r"\b[a-z_]+_[0-9a-f]{8}\b", "<id>", value)
    return value


def _record(section, entity, desc, spec):
    """Run the script against one entity and return what it answered."""
    steps = []

    def step(label, action, data):
        message = server.execute_modify(action, entity, data)
        steps.append({
            "step": label,
            "action": action,
            "data": _scrub(data),
            "message": _scrub(message),
            "stored": _scrub(server.load_json(f"{section}.json")),
        })

    actions = spec.get("actions", [])
    if desc.get("parent"):
        _seed_parent(desc)
    if "add" in actions:
        if spec.get("required"):
            step("add without required fields", "add",
                 _payload(entity, desc, spec, skip_required=True))
        step("add", "add", _payload(entity, desc, spec))
        step("add the same again", "add", _payload(entity, desc, spec))
        if desc.get("bulk"):
            # `bulk` promises a client may send the array's own name instead of
            # one value -- the path work_skill and work_highlight take.
            bulk = _payload(entity, desc, spec)
            bulk.pop(spec["identifier"], None)
            bulk[desc["bulk"]] = [f"{entity} bulk one", f"{entity} bulk two"]
            step("add in bulk", "add", bulk)
    if "update" in actions:
        step("update", "update", _payload(entity, desc, spec, pass_=1))
    if "remove" in actions:
        step("remove", "remove", _payload(entity, desc, spec))
        step("remove what is gone", "remove", _payload(entity, desc, spec))
    return steps


@pytest.mark.parametrize("section,entity", ENTITIES, ids=lambda v: v)
def test_entity_answers_and_stores_what_it_did_before(section, entity,
                                                      clean_database, as_user,
                                                      golden):
    desc = DESCRIPTORS[entity]
    settings_store.set_enabled_optins(sorted(DEFAULT_OFF))
    actual = _record(section, entity, desc, SCHEMA[section][entity])

    if REGEN:
        golden[entity] = actual
        return
    assert entity in golden, (
        f"{entity} is new to the vocabulary -- regenerate with GOLDEN_REGEN=1 "
        "and read the diff"
    )
    assert actual == golden[entity]


@pytest.fixture(scope="session")
def golden():
    if not REGEN:
        yield json.loads(FIXTURE.read_text()) if FIXTURE.exists() else {}
        return
    fresh = {}
    yield fresh
    FIXTURE.write_text(json.dumps(fresh, indent=1, ensure_ascii=False, sort_keys=True) + "\n")


def test_every_entity_in_the_vocabulary_is_covered(golden):
    """The fixture and the vocabulary agree, so an entity cannot quietly leave."""
    if REGEN:
        pytest.skip("regenerating")
    declared = {e for entities in SCHEMA.values() for e in entities}
    recorded = set(golden)
    assert not declared - recorded, f"no golden record for {sorted(declared - recorded)}"
    assert not recorded - declared, f"golden records an entity nobody declares: {sorted(recorded - declared)}"
