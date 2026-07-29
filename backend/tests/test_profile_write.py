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


def test_education_has_a_second_level_of_nesting(clean_database, as_user):
    """This test replaces one asserting the opposite, and the reason is worth
    keeping. Reading `execute_modify` alone said `coursework` was a bare string
    array -- that branch appended the string itself -- so an earlier draft
    concluded `profile` had no second level of child list. The EDITOR had
    always written {name, topics} objects into the same list. Both writers had
    to be read to see the real shape, and the disagreement between them was
    itself the bug (see the object-shape tests below).
    """
    server.execute_modify("add", "education", {"institution": "Northumbria"})
    server.execute_modify("add", "coursework",
                          {"institution": "Northumbria", "course": "Compilers",
                           "topics": ["parsing"]})
    [edu] = _profile()["education"]
    assert edu["coursework"] == [{"name": "Compilers", "topics": ["parsing"]}]


# ---------------------------------------------------------------------------
# coursework and clubs are lists of OBJECTS
#
# The editor has always written {name, topics} and {name, activities_involved};
# execute_modify appended a bare STRING into the same lists. So an AI-added
# course rendered blank in the UI and could never be removed -- `course in
# coursework` compares a string against a dict and never matches. Wave 6 makes
# the branches write objects and coerces legacy strings on read.
# ---------------------------------------------------------------------------


def _seed_education(institution="Northumbria"):
    server.execute_modify("add", "education", {"institution": institution})


def test_coursework_add_stores_an_object(clean_database, as_user):
    _seed_education()
    server.execute_modify("add", "coursework", {"institution": "Northumbria", "course": "Compilers"})
    [edu] = _profile()["education"]
    assert edu["coursework"] == [{"name": "Compilers", "topics": []}]


def test_coursework_add_carries_topics(clean_database, as_user):
    _seed_education()
    server.execute_modify("add", "coursework",
                          {"institution": "Northumbria", "course": "Compilers",
                           "topics": ["parsing"]})
    [edu] = _profile()["education"]
    assert edu["coursework"][0]["topics"] == ["parsing"]


def test_coursework_remove_now_finds_the_object(clean_database, as_user):
    """The bug: `course in coursework` compared a string to a dict, so an
    AI-added course could never be removed."""
    _seed_education()
    server.execute_modify("add", "coursework", {"institution": "Northumbria", "course": "Compilers"})
    msg = server.execute_modify("remove", "coursework",
                                {"institution": "Northumbria", "course": "Compilers"})
    assert msg.startswith("✅")
    assert _profile()["education"][0]["coursework"] == []


def test_coursework_add_is_still_deduped(clean_database, as_user):
    _seed_education()
    for _ in range(2):
        server.execute_modify("add", "coursework",
                              {"institution": "Northumbria", "course": "Compilers"})
    assert len(_profile()["education"][0]["coursework"]) == 1


def test_coursework_topic_writes_the_same_shape(clean_database, as_user):
    """It has always been a verbatim duplicate of the coursework branch."""
    _seed_education()
    server.execute_modify("add", "coursework_topic",
                          {"institution": "Northumbria", "topic": "Type Theory"})
    assert _profile()["education"][0]["coursework"] == [{"name": "Type Theory", "topics": []}]


def test_club_add_and_remove(clean_database, as_user):
    """Before wave 6 `clubs` had no entity and no branch at all -- the editor
    was its only writer, so no AI client could read into or out of it."""
    _seed_education()
    server.execute_modify("add", "club", {"institution": "Northumbria", "name": "Hack Soc",
                                          "activities_involved": ["mentoring"]})
    [edu] = _profile()["education"]
    assert edu["clubs"] == [{"name": "Hack Soc", "activities_involved": ["mentoring"]}]

    assert server.execute_modify("remove", "club",
                                 {"institution": "Northumbria", "name": "Hack Soc"}).startswith("✅")
    assert _profile()["education"][0]["clubs"] == []


def test_legacy_bare_strings_are_coerced_on_read(clean_database, as_user):
    """A record written before wave 6 holds a mix of both shapes. The renderer
    reads `.name` on these, and the pre-wave-6 chip control threw outright on
    an object, so the coercion is what stops a real record breaking the page."""
    import persona_store as store
    store.save("profile", {"education": [{
        "institution": "Northumbria",
        "coursework": ["Compilers", {"name": "Distributed Systems", "topics": ["raft"]}],
        "clubs": ["Hack Soc"],
    }]})
    [edu] = store.load("profile")["education"]
    assert edu["coursework"] == [
        {"name": "Compilers", "topics": []},
        {"name": "Distributed Systems", "topics": ["raft"]},
    ]
    assert edu["clubs"] == [{"name": "Hack Soc", "activities_involved": []}]


def test_the_coercion_is_idempotent(clean_database, as_user):
    import copy

    import persona_store as store
    store.save("profile", {"education": [{"institution": "N", "coursework": ["A"]}]})
    once = store.load("profile")
    twice = store._normalize("profile", copy.deepcopy(once))
    assert twice["education"][0]["coursework"] == once["education"][0]["coursework"]


def test_a_write_still_finds_an_un_normalised_legacy_string(clean_database, as_user):
    """_find_course stays shape-tolerant so a write reaching a blob that has
    not been through _normalize finds its entry rather than duplicating it."""
    assert server._find_course(["Compilers"], "compilers") == "Compilers"
    assert server._find_course([{"name": "Compilers"}], "COMPILERS") == {"name": "Compilers"}
    assert server._find_course([{"name": "Other"}], "Compilers") is None


# ---------------------------------------------------------------------------
# work_experience.skills -- added in wave 6 alongside the migration.
#
# Bare strings on the parent row, the same shape as `highlights`. Given its own
# entity so it is not UI-only: that asymmetry is exactly what `clubs` had, and
# a field no AI client can read into or out of is half a feature in a project
# whose point is portable context.
# ---------------------------------------------------------------------------


def test_add_seeds_skills(clean_database, as_user):
    _add_job()
    assert _profile()["work_experience"][0]["skills"] == []


def test_add_carries_skills(clean_database, as_user):
    _add_job(skills=["Python", "Kubernetes"])
    assert _profile()["work_experience"][0]["skills"] == ["Python", "Kubernetes"]


def test_update_replaces_the_whole_skill_list(clean_database, as_user):
    _add_job(skills=["Python"])
    server.execute_modify("update", "work_experience", {"company": "Acme", "skills": ["Go"]})
    assert _profile()["work_experience"][0]["skills"] == ["Go"]


def test_update_leaves_skills_alone_when_not_supplied(clean_database, as_user):
    _add_job(skills=["Python"])
    server.execute_modify("update", "work_experience", {"company": "Acme", "role": "Staff"})
    assert _profile()["work_experience"][0]["skills"] == ["Python"]


def test_update_can_clear_the_skill_list(clean_database, as_user):
    """An empty list is a real value here, not "unset" -- the guard tests
    isinstance, not truthiness, so a user CAN remove every skill."""
    _add_job(skills=["Python"])
    server.execute_modify("update", "work_experience", {"company": "Acme", "skills": []})
    assert _profile()["work_experience"][0]["skills"] == []


def test_work_skill_adds_one_and_dedupes(clean_database, as_user):
    _add_job()
    server.execute_modify("add", "work_skill", {"company": "Acme", "skill": "Python"})
    server.execute_modify("add", "work_skill", {"company": "Acme", "skill": "Python"})
    assert _profile()["work_experience"][0]["skills"] == ["Python"]


def test_work_skill_adds_many_at_once(clean_database, as_user):
    _add_job()
    server.execute_modify("add", "work_skill", {"company": "Acme", "skills": ["Go", "Rust"]})
    assert _profile()["work_experience"][0]["skills"] == ["Go", "Rust"]


def test_work_skill_removes(clean_database, as_user):
    _add_job(skills=["Python", "Go"])
    assert server.execute_modify("remove", "work_skill",
                                 {"company": "Acme", "skill": "Python"}).startswith("✅")
    assert _profile()["work_experience"][0]["skills"] == ["Go"]


def test_work_skill_needs_a_known_company(clean_database, as_user):
    assert server.execute_modify("add", "work_skill",
                                 {"company": "Nowhere", "skill": "Python"}).startswith("❌")


def test_work_skill_does_not_touch_highlights(clean_database, as_user):
    """Both are bare-string lists on the same row, so a copy-paste slip in the
    branch would write into the wrong one silently."""
    _add_job(highlights=["Shipped it"])
    server.execute_modify("add", "work_skill", {"company": "Acme", "skill": "Python"})
    job = _profile()["work_experience"][0]
    assert job["skills"] == ["Python"]
    assert job["highlights"] == ["Shipped it"]
