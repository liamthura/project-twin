import json

import db
import embeddings
import persona_store
import search_index
import server


def test_advisory_entities_rewrite_eligibility_is_derivable():
    """F2(a): locks TR-3's previously-unenforced invariant. Every
    ADVISORY_ENTITIES member must be either:

      - rewrite-eligible: its ENTITY_SCHEMA identifier is a
        search_index.TITLE_FIELDS member AND "update" is one of its
        supported actions -- an executable identifier value can be derived
        from a search hit's title. (The add->update rewrite this originally
        guarded lived in suggest_persona_update, retired 2026-07-31; the
        ordering property still governs which field flatten_entity picks as
        a document title, so the invariant outlived the caller.)
        For these, the identifier must also be the FIRST
        TITLE_FIELDS member appearing (in flatten-priority order) among the
        entity's own required+optional fields -- otherwise flatten_entity
        would pick a *different* field as the title, and rewriting the
        identifier from hit["title"] would silently target the wrong value
        (this is exactly what would break if e.g. work_experience's
        "company" were ever naively added to TITLE_FIELDS while "role"
        stays earlier in priority order).

      - hint-only: exactly the current, explicitly-known set --
        work_experience (identifier "company" is not title-like),
        top_of_mind (identifier "item" is not title-like, and the entity
        has no "update" action at all). Any other entity landing here means
        either ADVISORY_ENTITIES or ENTITY_SCHEMA drifted and this test
        needs a conscious update, not a silent pass. (Note: like/dislike
        moved to rewrite-eligible when "item" was added to TITLE_FIELDS.)
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


def test_hint_only_entity_still_surfaces_the_near_dupe(as_user, monkeypatch):
    """F2(b): behavioral counterpart to the schema guard above, carried over
    to propose_update.

    For a hint-only entity (work_experience), the dedupe pass must still find
    and attach the near-dupe so the user can compare -- what it must NOT do is
    silently rewrite the proposal to target an identifier it cannot derive.
    propose_update never rewrites at all: it reports conflicts_with_existing
    and leaves the agent's action alone, so the hazard the old rewrite carried
    is now structurally absent rather than guarded against.
    """
    _seed_work_experience(monkeypatch, None)
    out = json.loads(server.propose_update.fn(
        proposals=[{
            "kind": "entity", "action": "add", "entity": "work_experience",
            "data": {"company": "Acme", "role": "Senior Engineer"},
            "rationale": "They described the role as current.",
            "evidence": "I'm now a Senior Engineer at Acme",
        }],
        client="Claude Desktop",
    ))
    [result] = out["results"]
    assert result["result"] == "conflicts_with_existing"
    assert result["existing_entity"]["entity_id"].startswith("work_")
