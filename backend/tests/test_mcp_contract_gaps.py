"""The eight MCP contract gaps waves 5 and 6 recorded and wave 7 closed.

These are not one bug. They are one *class* of bug: places where what an MCP
client can do diverges from what `get_schema` says it can do, in either
direction. A declared action that does not exist (`link` had no `update`), a
stored key with no entity at all (`wellness.stress_triggers`), a key that
decides which entity a row IS but appears in neither entity's `required` nor
`optional` (`stance`), an `optional` field the update branch silently ignores
(`work_experience.highlights`), and the `if data.get(field)` idiom, which makes
a field writable but never clearable.

Every one of them was found by reading a branch against its manifest entity --
not by a guard. That is the standing argument for the backend reconciliation
these waves keep accruing toward:

  docs/superpowers/plans/2026-07-29-wave-5-storage-keys-reference.md  §4
  docs/superpowers/plans/2026-07-29-wave-6-storage-keys-reference.md  §5
"""
import server


def _profile():
    return server.load_json("profile.json")


def _lifestyle():
    return server.load_json("lifestyle.json")


def _preferences():
    return server.load_json("preferences.json")


# ---------------------------------------------------------------------------
# link.update -- wave 6 follow-up 5
#
# The entity declared add/remove only, so the only way to fix a typo'd URL was
# to remove the link and add it back, which loses its position in the list.
# ---------------------------------------------------------------------------


def _add_link(label="GitHub", url="https://example.com/a"):
    return server.execute_modify("add", "link", {"label": label, "url": url})


def test_link_update_changes_the_url(clean_database, as_user):
    _add_link()
    server.execute_modify("update", "link", {"label": "GitHub", "url": "https://example.com/b"})
    [link] = _profile()["contact"]["links"]
    assert link == {"url": "https://example.com/b", "label": "GitHub"}


def test_link_update_renames_via_new_label(clean_database, as_user):
    """`label` is the identifier, so a rename needs a second key. Sending a bare
    `label` can only ever mean "find this row"."""
    _add_link()
    server.execute_modify("update", "link", {"label": "GitHub", "new_label": "Code"})
    [link] = _profile()["contact"]["links"]
    assert link["label"] == "Code"
    assert link["url"] == "https://example.com/a"


def test_link_update_holds_position(clean_database, as_user):
    """The whole reason `update` exists rather than remove + re-add."""
    _add_link("GitHub", "https://example.com/a")
    _add_link("Site", "https://example.com/b")
    _add_link("Blog", "https://example.com/c")
    server.execute_modify("update", "link", {"label": "Site", "url": "https://example.com/z"})
    assert [l["label"] for l in _profile()["contact"]["links"]] == ["GitHub", "Site", "Blog"]


def test_link_update_rejects_an_unknown_label(clean_database, as_user):
    assert "not found" in server.execute_modify("update", "link", {"label": "Nope", "url": "x"})


def test_link_update_needs_something_to_change(clean_database, as_user):
    _add_link()
    result = server.execute_modify("update", "link", {"label": "GitHub"})
    assert "requires" in result


# ---------------------------------------------------------------------------
# basic_info clearing -- wave 6 follow-up 6
#
# `if data.get(field)` skips the empty string, so every one of these seven
# fields could be set over MCP and then never emptied again.
# ---------------------------------------------------------------------------


def test_basic_info_clears_an_optional_field(clean_database, as_user):
    server.execute_modify("update", "basic_info", {"bio": "Something I regret."})
    assert _profile()["bio"] == "Something I regret."
    server.execute_modify("update", "basic_info", {"bio": ""})
    assert _profile()["bio"] == ""


def test_basic_info_reports_a_clear_as_a_change(clean_database, as_user):
    """A cleared field has to count as `updated`, or the branch would return its
    "requires at least one of" error for a request it actually honoured."""
    result = server.execute_modify("update", "basic_info", {"preferred_name": ""})
    assert result.startswith("✅")
    assert "cleared" in result


def test_basic_info_refuses_to_clear_name(clean_database, as_user):
    """The one field a blank would ruin: it is what most readers title the
    persona with."""
    server.execute_modify("update", "basic_info", {"name": "Ada"})
    assert "cannot be cleared" in server.execute_modify("update", "basic_info", {"name": ""})
    assert _profile()["name"] == "Ada"


def test_basic_info_still_ignores_absent_fields(clean_database, as_user):
    """Presence, not truthiness -- but absence still means "leave alone", or
    every update would blank the six fields it did not mention."""
    server.execute_modify("update", "basic_info", {"bio": "kept", "location": "Berlin"})
    server.execute_modify("update", "basic_info", {"location": "Lisbon"})
    profile = _profile()
    assert profile["bio"] == "kept"
    assert profile["location"] == "Lisbon"


# ---------------------------------------------------------------------------
# hobby.notes clearing -- wave 5 follow-up 5
# ---------------------------------------------------------------------------


def test_hobby_notes_can_be_cleared(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Chess", "notes": "Started in May."})
    server.execute_modify("update", "hobby", {"name": "Chess", "notes": ""})
    [hobby] = _lifestyle()["hobbies"]
    assert hobby["notes"] == ""


def test_hobby_notes_survive_an_unrelated_update(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Chess", "notes": "Started in May."})
    server.execute_modify("update", "hobby", {"name": "Chess", "status": "paused"})
    [hobby] = _lifestyle()["hobbies"]
    assert hobby["notes"] == "Started in May."
    assert hobby["status"] == "paused"


def test_hobby_notes_clear_via_an_alias(clean_database, as_user):
    """`notes` collapses three input spellings, so the presence test has to
    check all three -- otherwise clearing worked under one name and not the
    others."""
    server.execute_modify("add", "hobby", {"name": "Chess", "notes": "Started in May."})
    server.execute_modify("update", "hobby", {"name": "Chess", "description": ""})
    [hobby] = _lifestyle()["hobbies"]
    assert hobby["notes"] == ""


# ---------------------------------------------------------------------------
# work_experience.update highlights -- wave 6 follow-up 7
#
# `highlights` sat in this entity's `optional` and was honoured by `add` but not
# by `update`, so once a row existed `work_highlight` was the only way to touch
# them -- and it can only append.
# ---------------------------------------------------------------------------


def _add_job(**extra):
    payload = {"role": "Engineer", "company": "Acme", "type": "full-time", "period": "2024-2026"}
    payload.update(extra)
    return server.execute_modify("add", "work_experience", payload)


def test_work_experience_update_replaces_highlights(clean_database, as_user):
    _add_job(highlights=["Old one."])
    server.execute_modify("update", "work_experience",
                          {"company": "Acme", "highlights": ["New one.", "And another."]})
    [job] = _profile()["work_experience"]
    assert job["highlights"] == ["New one.", "And another."]


def test_work_experience_update_can_clear_highlights(clean_database, as_user):
    """Wholesale replacement, like `skills` -- which is what makes `[]` a clear
    rather than a no-op. `work_highlight` has no removal path for the last one."""
    _add_job(highlights=["Old one."])
    server.execute_modify("update", "work_experience", {"company": "Acme", "highlights": []})
    [job] = _profile()["work_experience"]
    assert job["highlights"] == []


def test_work_experience_update_leaves_highlights_alone_when_absent(clean_database, as_user):
    _add_job(highlights=["Kept."])
    server.execute_modify("update", "work_experience", {"company": "Acme", "role": "Staff"})
    [job] = _profile()["work_experience"]
    assert job["highlights"] == ["Kept."]


# ---------------------------------------------------------------------------
# coursework / coursework_topic -- wave 6 follow-up 4
#
# Two branches, one list, verbatim identical bodies. Now one branch, two names.
# ---------------------------------------------------------------------------


def _add_school():
    return server.execute_modify("add", "education",
                                 {"institution": "State University", "course": "CS"})


def _coursework():
    [edu] = _profile()["education"]
    return edu["coursework"]


def test_both_entities_write_the_same_list(clean_database, as_user):
    _add_school()
    server.execute_modify("add", "coursework",
                          {"institution": "State University", "course": "Compilers"})
    server.execute_modify("add", "coursework_topic",
                          {"institution": "State University", "course": "Networks"})
    assert [c["name"] for c in _coursework()] == ["Compilers", "Networks"]


def test_either_entity_removes_the_other_s_row(clean_database, as_user):
    """The dedupe's real payoff: they were always one list, and now behave like
    it without two copies of the code having to agree."""
    _add_school()
    server.execute_modify("add", "coursework",
                          {"institution": "State University", "course": "Compilers"})
    server.execute_modify("remove", "coursework_topic",
                          {"institution": "State University", "course": "Compilers"})
    assert _coursework() == []


def test_both_entities_store_the_object_shape(clean_database, as_user):
    _add_school()
    server.execute_modify("add", "coursework_topic",
                          {"institution": "State University", "course": "Networks",
                           "topics": ["TCP", "routing"]})
    assert _coursework() == [{"name": "Networks", "topics": ["TCP", "routing"]}]


def test_each_entity_answers_to_the_other_s_spelling(clean_database, as_user):
    """The merged alias list. `course` still wins where both are sent, so no
    existing caller changes meaning."""
    _add_school()
    server.execute_modify("add", "coursework", {"institution": "State University", "topic": "Logic"})
    assert [c["name"] for c in _coursework()] == ["Logic"]


def test_messages_still_name_the_entity_called(clean_database, as_user):
    _add_school()
    assert "coursework topic" in server.execute_modify(
        "add", "coursework_topic", {"institution": "State University", "course": "Networks"})
    assert "coursework topic" not in server.execute_modify(
        "add", "coursework", {"institution": "State University", "course": "Compilers"})


# ---------------------------------------------------------------------------
# stance -- wave 5 follow-up 4
#
# `stance` is what decides whether a likes_dislikes row reads as a like or a
# dislike, and it was in neither entity's `required` nor `optional`, so no MCP
# client could see it existed.
# ---------------------------------------------------------------------------


def test_stance_is_declared_on_both_entities(clean_database, as_user):
    for entity in ("like", "dislike"):
        spec = server.ENTITY_SCHEMA["preferences"][entity]
        assert "stance" in spec["optional"]
        assert spec["valid_values"]["stance"] == ["like", "dislike"]


def _stances():
    """Rows here are id-bearing (persona_store assigns `taste_*`), so compare
    the two keys this section is about rather than the whole object."""
    return [(r["item"], r["stance"]) for r in _preferences()["likes_dislikes"]]


def test_entity_name_is_still_the_default_stance(clean_database, as_user):
    server.execute_modify("add", "dislike", {"item": "jargon"})
    assert _stances() == [("jargon", "dislike")]


def test_explicit_stance_wins_over_the_entity_name(clean_database, as_user):
    server.execute_modify("add", "like", {"item": "jargon", "stance": "dislike"})
    assert _stances() == [("jargon", "dislike")]


def test_update_flips_a_row_without_switching_entity(clean_database, as_user):
    """What declaring the field buys: before, flipping a row meant knowing you
    had to address it through the *other* entity."""
    server.execute_modify("add", "like", {"item": "long preambles"})
    server.execute_modify("update", "like", {"item": "long preambles", "stance": "dislike"})
    assert _stances() == [("long preambles", "dislike")]


def test_a_bad_stance_is_refused(clean_database, as_user):
    result = server.execute_modify("add", "like", {"item": "x", "stance": "loathe"})
    assert result.startswith("❌")
    assert _preferences().get("likes_dislikes", []) == []


# ---------------------------------------------------------------------------
# stress_trigger -- wave 5 follow-up 2
#
# `wellness.stress_triggers` had a seeded default, a UI node and an editor, and
# no entity and no execute_modify branch: an AI client could read the value in
# context and never change it.
# ---------------------------------------------------------------------------


def _triggers():
    return _lifestyle()["wellness"]["stress_triggers"]


def test_stress_trigger_add_and_remove(clean_database, as_user):
    server.execute_modify("add", "stress_trigger", {"trigger": "context switching"})
    assert _triggers() == ["context switching"]
    server.execute_modify("remove", "stress_trigger", {"trigger": "context switching"})
    assert _triggers() == []


def test_stress_triggers_are_bare_strings(clean_database, as_user):
    """Like `energy_peaks`, which this branch mirrors -- the UI's strings node
    would break on objects."""
    server.execute_modify("add", "stress_trigger", {"trigger": "open-plan noise"})
    assert all(isinstance(t, str) for t in _triggers())


def test_stress_trigger_is_case_insensitively_deduped(clean_database, as_user):
    server.execute_modify("add", "stress_trigger", {"trigger": "Tight deadlines"})
    result = server.execute_modify("add", "stress_trigger", {"trigger": "tight deadlines"})
    assert result.startswith("ℹ️")
    assert _triggers() == ["Tight deadlines"]


def test_stress_trigger_gets_no_duplicate_advisory(clean_database, as_user):
    """A plain-value list with no ids, so it cannot resolve to an entity_id --
    the same reason `energy_peak` and `personality_trait` are excluded."""
    assert "stress_trigger" not in server.ADVISORY_ENTITIES


# ---------------------------------------------------------------------------
# preference cannot overwrite a list with a scalar -- wave 5 follow-up 3
#
# The generic escape hatch writes any key under any category, which let it
# replace a stored list with a bare string. No reader expects that shape.
# ---------------------------------------------------------------------------


def test_preference_refuses_to_scalarise_a_list(clean_database, as_user):
    server.execute_modify("add", "preference",
                          {"category": "code_style", "key": "tools", "value": ["vim", "ripgrep"]})
    result = server.execute_modify("update", "preference",
                                   {"category": "code_style", "key": "tools", "value": "vim"})
    assert result.startswith("❌")
    assert _preferences()["code_style"]["tools"] == ["vim", "ripgrep"]


def test_preference_replaces_a_list_with_another_list(clean_database, as_user):
    """The guard is about shape, not about locking the key."""
    server.execute_modify("add", "preference",
                          {"category": "code_style", "key": "tools", "value": ["vim"]})
    server.execute_modify("update", "preference",
                          {"category": "code_style", "key": "tools", "value": ["helix"]})
    assert _preferences()["code_style"]["tools"] == ["helix"]


def test_preference_can_still_drop_the_key_entirely(clean_database, as_user):
    """`remove` is the escape hatch from the guard -- otherwise a key that
    became a list could never go back to anything else."""
    server.execute_modify("add", "preference",
                          {"category": "code_style", "key": "tools", "value": ["vim"]})
    server.execute_modify("remove", "preference", {"category": "code_style", "key": "tools"})
    assert "tools" not in _preferences()["code_style"]


def test_preference_scalars_are_untouched(clean_database, as_user):
    server.execute_modify("add", "preference",
                          {"category": "general", "key": "units", "value": "metric"})
    server.execute_modify("update", "preference",
                          {"category": "general", "key": "units", "value": "imperial"})
    assert _preferences()["general"]["units"] == "imperial"


# ---------------------------------------------------------------------------
# The meta-schema affordance the above needed
# ---------------------------------------------------------------------------


def test_entity_comments_never_reach_a_client(clean_database, as_user):
    """`$comment` is for the next author; `description` is the tool contract.
    ENTITY_SCHEMA is what `get_schema` hands out, so the split has to hold there
    -- pack_loader.build_entity_schema drops it rather than trusting readers to."""
    for entities in server.ENTITY_SCHEMA.values():
        for name, spec in entities.items():
            assert "$comment" not in spec, name
