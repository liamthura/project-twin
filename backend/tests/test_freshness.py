"""Phase 4 freshness: updated_at surfacing + top-of-mind staleness advisory."""
import json

import psycopg

import db
import server
from tests.conftest import TEST_DATABASE_URL


def _backdate(entity_id, days):
    """Age an entity's search-index row by `days` days."""
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        conn.execute(
            "update persona_search set updated_at = now() - make_interval(days => %s)"
            " where entity_id = %s",
            (days, entity_id),
        )


def _first_id(file_type, list_key):
    return server.load_json(f"{file_type}.json")[list_key][0]["id"]


def test_get_entity_includes_updated_at(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering", "skill_level": "beginner"})
    hid = _first_id("lifestyle", "hobbies")
    payload = json.loads(server.get_entity.fn(hid))
    assert payload["entity_id"] == hid
    assert "updated_at" in payload
    assert len(payload["updated_at"]) == 10  # YYYY-MM-DD


def test_get_entity_batch_includes_updated_at(clean_database, as_user):
    server.execute_modify("add", "hobby", {"name": "Bouldering"})
    server.execute_modify("add", "domain", {"name": "Rust", "level": "learning"})
    ids = [_first_id("lifestyle", "hobbies"), _first_id("knowledge", "domains")]
    payload = json.loads(server.get_entity.fn(ids))
    assert all("updated_at" in e for e in payload["entities"])


def test_titles_stubs_carry_updated_at(clean_database, as_user):
    server.execute_modify("add", "goal", {"title": "Ship phase 4"})
    ctx = server.get_scoped_context("goals", detail="titles")["context"]
    [stub] = ctx["goals"]["goals"]
    assert set(stub) == {"id", "title", "updated_at"}


def test_stale_top_of_mind_triggers_advisory(clean_database, as_user):
    server.execute_modify("add", "top_of_mind", {"item": "Old thought"})
    server.execute_modify("add", "top_of_mind", {"item": "Fresh thought"})
    old_id = next(t["id"] for t in server.load_json("projects.json")["top_of_mind"]
                  if t["idea"] == "Old thought")
    _backdate(old_id, 40)
    payload = server.get_scoped_context("minimal")
    assert payload["advisories"] == [
        "1 top-of-mind item(s) unchanged for over 30 days — consider reviewing or removing them"
    ]


def test_fresh_top_of_mind_no_advisory(clean_database, as_user):
    server.execute_modify("add", "top_of_mind", {"item": "Fresh thought"})
    payload = server.get_scoped_context("minimal")
    assert "advisories" not in payload
