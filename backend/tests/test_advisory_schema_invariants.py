import json

import db
import embeddings
import persona_store
import search_index
import server
from tests.test_suggest_dedupe import _fixed_analysis


def test_advisory_entities_rewrite_eligibility_is_derivable():
    """F2(a): locks TR-3's previously-unenforced invariant. Every
    ADVISORY_ENTITIES member must be either:

      - rewrite-eligible: its ENTITY_SCHEMA identifier is a
        search_index.TITLE_FIELDS member AND "update" is one of its
        supported actions -- suggest_persona_update's add->update rewrite
        can safely derive an executable identifier value from a search hit's
        title. For these, the identifier must also be the FIRST
        TITLE_FIELDS member appearing (in flatten-priority order) among the
        entity's own required+optional fields -- otherwise flatten_entity
        would pick a *different* field as the title, and rewriting the
        identifier from hit["title"] would silently target the wrong value
        (this is exactly what would break if e.g. work_experience's
        "company" were ever naively added to TITLE_FIELDS while "role"
        stays earlier in priority order).

      - hint-only: exactly the current, explicitly-known set --
        work_experience (identifier "company" is not title-like) and
        top_of_mind (identifier "item" is not title-like, and the entity
        has no "update" action at all). Any other entity landing here means
        either ADVISORY_ENTITIES or ENTITY_SCHEMA drifted and this test
        needs a conscious update, not a silent pass.
    """
    expected_hint_only = {"work_experience", "top_of_mind"}
    hint_only_seen = set()

    for entity, (file_type, _list_key) in server.ADVISORY_ENTITIES.items():
        spec = server.ENTITY_SCHEMA[file_type][entity]
        identifier = spec["identifier"]
        actions = spec.get("actions", [])
        rewrite_eligible = (
            identifier in search_index.TITLE_FIELDS and "update" in actions
        )

        if not rewrite_eligible:
            hint_only_seen.add(entity)
            continue

        fields = list(spec.get("required", [])) + list(spec.get("optional", []))
        title_fields_present = [f for f in search_index.TITLE_FIELDS if f in fields]
        assert title_fields_present, (
            f"{entity}: marked rewrite-eligible (identifier {identifier!r} is "
            "in TITLE_FIELDS) but no TITLE_FIELDS member is present among "
            f"its schema fields {fields!r}"
        )
        assert title_fields_present[0] == identifier, (
            f"{entity}: identifier {identifier!r} is not the first "
            "TITLE_FIELDS member in flatten-priority order among "
            f"{title_fields_present!r} -- flatten_entity would derive its "
            "title from a different field, making an update-rewrite target "
            "the wrong identifier value"
        )

    assert hint_only_seen == expected_hint_only


def _seed_work_experience(monkeypatch, provider,
                          company="Acme", role="Senior Engineer"):
    monkeypatch.setattr(embeddings, "get_provider", lambda: provider)
    persona_store.save("profile", {
        "work_experience": [{"company": company, "role": role}],
        "education": [], "languages_spoken": [], "career_aspirations": [],
        "goals_and_careers": [],
    })
    uid = db.current_user_id.get()
    search_index.sync_index(uid, "profile", persona_store.load("profile"),
                            embed_sync=True)


def test_hint_only_suggest_stays_add_with_existing_entity(as_user, monkeypatch):
    """F2(b): behavioral counterpart to the schema guard above. For a
    hint-only entity (work_experience), suggest_persona_update's dedupe pass
    must still find and attach the near-dupe (existing_entity), but must
    NOT rewrite the suggestion's action to "update" -- there's no safe,
    executable identifier value to rewrite it to."""
    _seed_work_experience(monkeypatch, None)
    monkeypatch.setattr(server, "analyze_message_for_capture", _fixed_analysis([
        {"action": "add", "entity": "work_experience",
         "data": {"company": "Acme", "role": "Senior Engineer"},
         "reason": "test", "confidence": 0.8},
    ]))
    out = json.loads(server.suggest_persona_update.fn(
        "I'm now a Senior Engineer at Acme"))
    assert out["dedupe_checked"] is True
    matched = [s for s in out["suggestions"] if s.get("existing_entity")]
    assert matched  # sanity: dedupe actually fired
    for s in matched:
        assert s["action"] == "add"
        assert s["existing_entity"]["entity_id"].startswith("work_")
