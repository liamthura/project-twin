"""`profile` write paths, and the vocabulary corrections wave 6 made.

`profile.entities` declared seven field names nothing stored and omitted seven
that were stored. Neither `ui` guard could catch any of it: every phantom sat in
an entity's `optional` (so the spelling check accepted it) and seven of the ten
entities are absent from FIELD_ALIASES (so the alias check skipped them).

See docs/superpowers/plans/2026-07-29-wave-6-storage-keys-reference.md.
"""
import server


def _profile():
    return server.load_json("profile.json")


# ---------------------------------------------------------------------------
# work_experience: `location` and `description` become real
#
# Both were declared in the tool contract and written by NOTHING -- not
# execute_modify, not the editor. Wave 6 makes them persist rather than
# dropping them.
# ---------------------------------------------------------------------------


def _add_job(**extra):
    payload = {"role": "Engineer", "company": "Acme", "type": "full-time", "period": "2024-2026"}
    payload.update(extra)
    return server.execute_modify("add", "work_experience", payload)


def test_add_stores_location_and_description(clean_database, as_user):
    _add_job(location="Remote", description="Built the thing.")
    [job] = _profile()["work_experience"]
    assert job["location"] == "Remote"
    assert job["description"] == "Built the thing."


def test_add_defaults_location_and_description_to_empty(clean_database, as_user):
    """Every other optional key on this branch is seeded, so a row written
    without them still carries them -- the UI binds both and would otherwise
    show `undefined` until first edit."""
    _add_job()
    [job] = _profile()["work_experience"]
    assert job["location"] == ""
    assert job["description"] == ""


def test_update_stores_location_and_description(clean_database, as_user):
    _add_job()
    server.execute_modify("update", "work_experience",
                          {"company": "Acme", "location": "Berlin", "description": "Led it."})
    [job] = _profile()["work_experience"]
    assert job["location"] == "Berlin"
    assert job["description"] == "Led it."


def test_update_leaves_untouched_fields_alone(clean_database, as_user):
    _add_job(location="Remote", description="Built the thing.")
    server.execute_modify("update", "work_experience", {"company": "Acme", "role": "Staff Engineer"})
    [job] = _profile()["work_experience"]
    assert job["role"] == "Staff Engineer"
    assert job["location"] == "Remote"
    assert job["description"] == "Built the thing."
    assert job["period"] == "2024-2026"


def test_add_still_requires_its_four_core_fields(clean_database, as_user):
    """Making two optional keys real must not relax what the branch demands."""
    msg = server.execute_modify("add", "work_experience", {"company": "Acme"})
    assert msg.startswith("❌")
    assert _profile()["work_experience"] == []


# ---------------------------------------------------------------------------
# The vocabulary corrections. Each asserts the STORED key, so a test fails if
# a later edit reintroduces the phantom.
# ---------------------------------------------------------------------------


def test_language_stores_fluency_not_proficiency(clean_database, as_user):
    """`proficiency` is the third member of get_field(data, "fluency", "level",
    "proficiency") -- an input alias that is never persisted."""
    server.execute_modify("add", "language", {"name": "Welsh", "proficiency": "fluent"})
    [lang] = _profile()["languages_spoken"]
    assert lang["fluency"] == "fluent"
    assert "proficiency" not in lang


def test_email_stores_purpose_and_requires_it(clean_database, as_user):
    """The branch returns an error for a missing `purpose`, a key the contract
    did not mention at all -- so an MCP client following get_schema could not
    add an email."""
    assert server.execute_modify("add", "email", {"address": "a@b.co"}).startswith("❌")
    server.execute_modify("add", "email", {"address": "a@b.co", "purpose": "work"})
    [email] = _profile()["contact"]["emails"]
    assert email["purpose"] == "work"
    assert "label" not in email


def test_education_stores_its_real_keys_not_the_declared_ones(clean_database, as_user):
    server.execute_modify("add", "education", {
        "institution": "Northumbria",
        "degree_level": "BSc",
        "field_of_study": "Computer Science",
        "start_year": "2022",
        "end_year": "2026",
    })
    [edu] = _profile()["education"]
    assert edu["degree_level"] == "BSc"
    assert edu["field_of_study"] == "Computer Science"
    assert (edu["start_year"], edu["end_year"]) == ("2022", "2026")
    assert edu["status"] == "current"  # seeded, and absent from the old vocabulary
    for phantom in ("degree", "field", "period"):
        assert phantom not in edu


def test_coursework_is_a_bare_string_array(clean_database, as_user):
    """Not a list of objects -- which is why `profile` has no second level of
    child list, contrary to what the spec's wave table predicted."""
    server.execute_modify("add", "education", {"institution": "Northumbria"})
    server.execute_modify("add", "coursework", {"institution": "Northumbria", "course": "Compilers"})
    [edu] = _profile()["education"]
    assert edu["coursework"] == ["Compilers"]
