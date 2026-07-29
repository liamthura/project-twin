"""Does `execute_modify` actually store the fields the vocabulary declares?

This is the guard the section-editor consolidation deferred through six waves.
Every other check on the entity vocabulary is a *spelling* check: it asks whether
a declared name matches something, never whether anything writes it. So a field
can sit in an entity's `optional` forever, be advertised to every MCP client by
`get_schema`, and be discarded on arrival. Wave 6 found seven such fields in
`profile` alone.

Both write actions are swept: `add` (wave 8) and `update` (wave 9). Sweeping
`update` is not redundant -- a branch can honour a field on the way in and ignore
it on every subsequent edit, which is what `work_experience.highlights` did until
wave 7 and what six more fields did until wave 9.

A note on `sleep.day_type`, which the consolidation spec cited from wave 4 onward
as the standing example of a field the guards could not verify: building this
audit settled it, and it is **not** a defect. `day_type` is a router -- it selects
which sub-object (`weekday`/`weekend`) receives the write -- correctly declared as
the entity's `identifier`. It is never stored as a key, but it does determine what
is stored, which is the question that actually matters. Recorded here so it stops
being hunted.

**The method is empirical, not declarative.** A hand-written table of "what each
branch stores" would be a second copy of the truth, free to drift from the first
-- which is the bug, not the fix. Instead this runs `add` twice with two
DIFFERENT values for one field and diffs the stored blob. If the blob comes out
identical either way, nothing in the branch read the field.

Diffing two live values, rather than present-versus-absent, is what makes it
immune to defaults: a field seeded with the same value the probe happened to send
would look "written" under a presence test. The probe pairs are chosen to defeat
the three ways a branch can quietly ignore input:

    scalar vs list   -- catches `if isinstance(v, list)` guards
    true vs false    -- catches bool coercion (both of the above are truthy)
    enum[0] vs [-1]  -- for fields whose values are constrained

A field that survives all of them unchanged is not stored. Anything genuinely
declared-but-unstored belongs in ALLOWED_UNSTORED below, with a reason -- the
same "declare the divergence rather than assume it" discipline the `ui` guards
already use.
"""
import copy

import pytest

import sections
import server
import settings_store

# ---------------------------------------------------------------------------
# Fields that are declared and deliberately not stored.
#
# Every entry is a router: a value the branch reads to decide WHERE to write,
# never a value it writes. Removing them from the vocabulary would break the
# call -- an MCP client has to send them -- so they are declared and excluded
# here rather than deleted.
# ---------------------------------------------------------------------------
ALLOWED_UNSTORED = {
    # Parent identifiers on nested entities: they locate the row to attach to.
    ("profile", "work_highlight", "company"): "parent selector",
    ("profile", "work_skill", "company"): "parent selector",
    ("profile", "education_highlight", "institution"): "parent selector",
    ("profile", "coursework", "institution"): "parent selector",
    ("profile", "coursework_topic", "institution"): "parent selector",
    ("profile", "club", "institution"): "parent selector",
    ("knowledge", "domain_reference", "domain_name"): "parent selector",
    ("knowledge", "mental_tab_reference", "title"): "parent selector",
    ("projects", "project_tag", "project_name"): "parent selector",
    ("projects", "project_reference", "project_name"): "parent selector",
    ("projects", "project_highlight", "project_name"): "parent selector",
    ("lifestyle", "hobby_reference", "hobby_name"): "parent selector",
    ("lifestyle", "hobby_specific", "hobby_name"): "parent selector",
    # Chooses which sub-object of the section is written, not a stored key.
    ("knowledge", "knowledge", "category"): "selects the target list",
    ("preferences", "preference", "category"): "selects the target sub-object",
    # Rename input for an entity whose identifier is the field being renamed.
    ("profile", "link", "new_label"): "rename input; the stored key is `label`",
}

# Entities whose `add` needs a payload `required` cannot describe, with the
# extra fields the probe must send to get past the branch's own check.
#
# `required` is a flat list of names: it can say "these are all needed", never
# "at least one of these". Where a branch genuinely wants the latter, the honest
# move is to record it here rather than to over-declare `required` (which would
# make get_schema demand both) or under-declare it (which is the divergence this
# file exists to catch).
CONDITIONAL_REQUIRED = {
    ("preferences", "mood_override"): (
        {"tone": "brief"},
        "branch needs at least one of tone/detail_level; `required` cannot say 'one of'",
    ),
}

# Parent rows the nested entities need before they have anywhere to write.
_PARENT_SEEDS = {
    "company": ("work_experience", {"role": "R", "company": "ParentCo",
                                    "type": "full-time", "period": "2024"}, "ParentCo"),
    "institution": ("education", {"institution": "ParentU", "course": "C"}, "ParentU"),
    "domain_name": ("domain", {"name": "ParentDomain"}, "ParentDomain"),
    "title": ("mental_tab", {"title": "ParentTab"}, "ParentTab"),
    "project_name": ("project", {"name": "ParentProject", "description": "D"}, "ParentProject"),
    "hobby_name": ("hobby", {"name": "ParentHobby"}, "ParentHobby"),
}

# Keys that move on their own and would register as a diff every run.
_VOLATILE = {"id", "last_updated", "added", "added_date", "created",
             "updated_at", "date_added", "last_reviewed"}

_PROBE_PAIRS = [
    ("probe_alpha", ["probe_beta"]),
    (True, False),
]


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in _VOLATILE}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def _reset(section):
    server.save_json(f"{section}.json",
                     copy.deepcopy(sections.SECTION_REGISTRY[section].default))


def _sample(field, spec):
    valid = (spec.get("valid_values") or {}).get(field)
    return valid[0] if valid else f"base_{field}"


def _baseline(spec):
    """Only the DECLARED required fields.

    Deliberately not "every declared field": filling the optionals too masks any
    field an alias out-ranks -- `work_skill` reads `skills` in preference to
    `skill`, so with both set, varying `skill` changes nothing and it reads as a
    phantom. Building from `required` alone also means a branch that demands more
    than it declares fails loudly here, which is its own finding.
    """
    return {f: _sample(f, spec) for f in spec.get("required", [])}


def _payload(section, entity, spec):
    """A baseline `add` payload: declared required, plus any conditional extras."""
    payload = _baseline(spec)
    extra = CONDITIONAL_REQUIRED.get((section, entity))
    if extra:
        payload.update(extra[0])
    _seed_parent(spec, payload)
    return payload


def _seed_parent(spec, payload):
    parent = spec.get("parent")
    if not parent:
        return True
    entity, data, key = _PARENT_SEEDS[parent]
    server.execute_modify("add", entity, data)
    payload[parent] = key
    return True


def _store_after(section, entity, spec, field, value):
    """Run `add` with one field overridden; return (ok, stored blob)."""
    _reset(section)
    payload = _payload(section, entity, spec)
    payload[field] = value
    try:
        result = server.execute_modify("add", entity, payload)
    except Exception as exc:  # noqa: BLE001 -- a crash is a finding, see below
        pytest.fail(
            f"{section}.{entity}.{field}={value!r} raised {type(exc).__name__}: {exc}. "
            f"execute_modify must return an error string, never raise: every one of "
            f"these is an unhandled 500 reachable from an MCP payload."
        )
    ok = isinstance(result, str) and result.startswith("✅")
    return ok, _strip(server.load_json(f"{section}.json"))


def _is_stored(section, entity, spec, field):
    """True if varying `field` changes what lands in storage."""
    pairs = list(_PROBE_PAIRS)
    valid = (spec.get("valid_values") or {}).get(field)
    if valid and len(valid) > 1:
        pairs.insert(0, (valid[0], valid[-1]))

    any_accepted = False
    for v1, v2 in pairs:
        ok1, blob1 = _store_after(section, entity, spec, field, v1)
        ok2, blob2 = _store_after(section, entity, spec, field, v2)
        any_accepted = any_accepted or ok1 or ok2
        if blob1 != blob2:
            return True, True
    return False, any_accepted


def _probeable_entities(action="add"):
    for section, entities in server.ENTITY_SCHEMA.items():
        for entity, spec in entities.items():
            if action in spec.get("actions", []):
                yield section, entity, spec


# ---------------------------------------------------------------------------
# The same probe, applied to `update`.
#
# `add` is where twelve of twelve recorded defects lived, but it is not where
# they stop: wave 7's `work_experience.update` silently dropped `highlights`
# while `add` stored them, and that was found by reading, not by a guard. An
# entity can honour a field on the way in and ignore it on every subsequent
# edit.
#
# The shape is the same -- vary one field, diff the blob -- with one extra step:
# `update` needs a row to target, so each probe seeds one first.
# ---------------------------------------------------------------------------

# Declared on an update-capable entity and legitimately not written BY update.
#
# The identifier and the parent are excluded automatically below: on `update`
# they select the row rather than change it, which is what `identifier` means.
# This list is for anything else.
ALLOWED_UNSTORED_ON_UPDATE = {
    ("knowledge", "knowledge", "category"): "selects the target list",
    ("preferences", "preference", "category"): "selects the target sub-object",
}


def _locator(section, entity, spec):
    """Create the row `update` will target, and return the payload that finds it.

    Update-only entities (`basic_info`, `communication_default`, `sleep`) have
    nothing to seed: they write into a fixed object that always exists.
    """
    locate = {}
    identifier = spec.get("identifier")
    if "add" in spec.get("actions", []):
        payload = _payload(section, entity, spec)
        server.execute_modify("add", entity, payload)
        if spec.get("parent"):
            locate[spec["parent"]] = payload[spec["parent"]]
        if identifier:
            locate[identifier] = payload.get(identifier, _sample(identifier, spec))
    else:
        if identifier:
            locate[identifier] = _sample(identifier, spec)
        extra = CONDITIONAL_REQUIRED.get((section, entity))
        if extra:
            locate.update(extra[0])
    return locate


def _update_after(section, entity, spec, field, value):
    """Seed a row, `update` one field on it, return (ok, stored blob)."""
    _reset(section)
    payload = _locator(section, entity, spec)
    payload[field] = value
    try:
        result = server.execute_modify("update", entity, payload)
    except Exception as exc:  # noqa: BLE001
        pytest.fail(
            f"update {section}.{entity}.{field}={value!r} raised "
            f"{type(exc).__name__}: {exc}. execute_modify must return an error "
            f"string, never raise."
        )
    ok = isinstance(result, str) and result.startswith("✅")
    return ok, _strip(server.load_json(f"{section}.json"))


def _is_updatable(section, entity, spec, field):
    pairs = list(_PROBE_PAIRS)
    valid = (spec.get("valid_values") or {}).get(field)
    if valid and len(valid) > 1:
        pairs.insert(0, (valid[0], valid[-1]))

    any_accepted = False
    for v1, v2 in pairs:
        ok1, blob1 = _update_after(section, entity, spec, field, v1)
        ok2, blob2 = _update_after(section, entity, spec, field, v2)
        any_accepted = any_accepted or ok1 or ok2
        if blob1 != blob2:
            return True, True
    return False, any_accepted


@pytest.fixture
def all_packs_on(as_user):
    """`media` and `aesthetics` are default-off, and writes to a disabled
    section are refused -- which would read as "every field is a phantom"."""
    settings_store.set_settings({"enabled_sections": list(sections.SECTION_REGISTRY),
                                 "disabled_sections": []})
    yield


def test_every_declared_field_is_actually_stored(clean_database, all_packs_on):
    phantoms, unreachable = [], []

    for section, entity, spec in _probeable_entities():
        fields = dict.fromkeys(spec.get("required", []) + spec.get("optional", []))
        for field in fields:
            if (section, entity, field) in ALLOWED_UNSTORED:
                continue
            stored, accepted = _is_stored(section, entity, spec, field)
            if stored:
                continue
            (unreachable if not accepted else phantoms).append(f"{section}.{entity}.{field}")

    assert not phantoms, (
        "These fields are declared in the entity vocabulary and written by nothing. "
        "`get_schema` advertises them to every MCP client and values sent under them "
        "are discarded on arrival:\n  " + "\n  ".join(phantoms) +
        "\n\nFix the branch to store them, drop them from the manifest, or -- if the "
        "field is a router the caller must send -- add it to ALLOWED_UNSTORED with a "
        "reason."
    )
    assert not unreachable, (
        "`add` was rejected for every probe value of these fields, so whether they are "
        "stored could not be established:\n  " + "\n  ".join(unreachable) +
        "\n\nUsually this means the branch demands a field the entity does not declare "
        "`required`, so the probe's baseline payload is incomplete."
    )


def test_declared_required_is_enough_to_add(clean_database, all_packs_on):
    """An `add` built from exactly the declared `required` fields must succeed.

    This is the divergence in the other direction, and it is the one that made
    the audit above look broken before it looked right: `work_experience`
    declared `required: ["company"]` while its branch demanded
    role/company/type/period, so a client following `get_schema` got a rejection
    it had no way to predict.
    """
    failures = []
    for section, entity, spec in _probeable_entities():
        _reset(section)
        payload = _payload(section, entity, spec)
        result = server.execute_modify("add", entity, payload)
        if not (isinstance(result, str) and result.startswith(("✅", "ℹ️"))):
            failures.append(f"{section}.{entity}: required={spec.get('required')} -> {result}")

    assert not failures, (
        "These entities reject a payload built from exactly the fields they declare "
        "`required`:\n  " + "\n  ".join(failures) +
        "\n\nEither the branch is demanding more than it declares, or `required` names "
        "a field the branch does not accept under that spelling."
    )


def test_no_payload_shape_raises(clean_database, all_packs_on):
    """`execute_modify` returns errors; it must never raise.

    Twelve entities used to raise AttributeError when an identifier arrived as a
    list, because `find_in_array` called `.lower()` on it -- an unhandled 500 out
    of any MCP client that sent `{"company": ["Acme"]}`. `knowledge` and
    `preference` raised TypeError for the same class of input, using it as a dict
    key. The audit above exercises exactly these shapes; this test names the
    property so a regression reads as what it is.
    """
    for section, entity, spec in _probeable_entities():
        for field in dict.fromkeys(spec.get("required", []) + spec.get("optional", [])):
            for value in (["listy"], True, 7):
                _reset(section)
                payload = _payload(section, entity, spec)
                payload[field] = value
                try:
                    server.execute_modify("add", entity, payload)
                except Exception as exc:  # noqa: BLE001
                    pytest.fail(f"{section}.{entity}.{field}={value!r} raised "
                                f"{type(exc).__name__}: {exc}")


def test_every_declared_field_is_writable_by_update(clean_database, all_packs_on):
    """A field an entity declares must be changeable through `update`, not only
    settable through `add`.

    `work_experience.highlights` was exactly this before wave 7: stored by `add`,
    ignored by `update`, so once a row existed the only way to touch it was
    `work_highlight`, which can only append. That gap survived six waves of
    reading precisely because nothing swept it.
    """
    phantoms, unreachable = [], []

    for section, entity, spec in _probeable_entities("update"):
        skip = {spec.get("identifier"), spec.get("parent")}
        for field in dict.fromkeys(spec.get("required", []) + spec.get("optional", [])):
            if field in skip or (section, entity, field) in ALLOWED_UNSTORED_ON_UPDATE:
                continue
            stored, accepted = _is_updatable(section, entity, spec, field)
            if stored:
                continue
            (unreachable if not accepted else phantoms).append(f"{section}.{entity}.{field}")

    assert not phantoms, (
        "These fields are declared on an entity that supports `update`, and `update` "
        "does not write them. `add` may well store them -- which makes the field look "
        "real right up until someone tries to change it:\n  " + "\n  ".join(phantoms) +
        "\n\nFix the update branch, or add the field to ALLOWED_UNSTORED_ON_UPDATE with "
        "a reason. The identifier and parent are skipped automatically."
    )
    assert not unreachable, (
        "`update` was rejected for every probe value of these fields, so whether they "
        "are written could not be established:\n  " + "\n  ".join(unreachable)
    )


def test_no_update_payload_shape_raises(clean_database, all_packs_on):
    """`update` must return errors too, never raise."""
    for section, entity, spec in _probeable_entities("update"):
        for field in dict.fromkeys(spec.get("required", []) + spec.get("optional", [])):
            for value in (["listy"], True, 7):
                _reset(section)
                payload = _locator(section, entity, spec)
                payload[field] = value
                try:
                    server.execute_modify("update", entity, payload)
                except Exception as exc:  # noqa: BLE001
                    pytest.fail(f"update {section}.{entity}.{field}={value!r} raised "
                                f"{type(exc).__name__}: {exc}")
