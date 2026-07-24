"""Generic schema-driven write path for manifest-only pack entities."""
import server
import settings_store


def _enable(*keys):
    settings_store.set_enabled_optins(list(keys))


def test_media_add_with_validation(clean_database, as_user):
    _enable("media")
    msg = server.execute_modify("add", "media_item",
                                {"title": "Dune", "kind": "book", "status": "want", "tags": ["scifi"]})
    assert msg.startswith("✅")
    [item] = server.load_json("media.json")["items"]
    assert item["title"] == "Dune" and item["kind"] == "book" and item["tags"] == ["scifi"]


def test_media_invalid_enum_errors(clean_database, as_user):
    _enable("media")
    msg = server.execute_modify("add", "media_item", {"title": "X", "kind": "scroll"})
    assert msg.startswith("❌") and "book" in msg  # names the valid set


def test_media_duplicate_identifier(clean_database, as_user):
    _enable("media")
    server.execute_modify("add", "media_item", {"title": "Dune"})
    msg = server.execute_modify("add", "media_item", {"title": "Dune"})
    assert msg.startswith("ℹ️")


def test_media_update_and_remove(clean_database, as_user):
    _enable("media")
    server.execute_modify("add", "media_item", {"title": "Dune", "status": "want"})
    msg = server.execute_modify("update", "media_item", {"title": "Dune", "status": "finished", "rating": "5"})
    assert msg.startswith("✅")
    [item] = server.load_json("media.json")["items"]
    assert item["status"] == "finished" and item["rating"] == "5"
    assert server.execute_modify("remove", "media_item", {"title": "Dune"}).startswith("✅")
    assert server.load_json("media.json")["items"] == []


def test_aesthetic_field_defaults_apply(clean_database, as_user):
    _enable("aesthetics")
    msg = server.execute_modify("add", "aesthetic", {"name": "Minimalist", "domain": "ui"})
    assert msg.startswith("✅")
    [style] = server.load_json("aesthetics.json")["styles"]
    assert style["stance"] == "like"  # field_defaults
    assert style["domain"] == "ui"


def test_disabled_pack_blocks_generic_writes(clean_database, as_user):
    msg = server.execute_modify("add", "media_item", {"title": "Dune"})
    assert msg.startswith("❌") and "disabled" in msg.lower()


def test_generic_entities_get_dupe_advisory_mapping(clean_database):
    assert server.ADVISORY_ENTITIES["media_item"] == ("media", "items")
    assert server.ADVISORY_ENTITIES["aesthetic"] == ("aesthetics", "styles")


def test_unknown_entity_still_errors(clean_database, as_user):
    msg = server.execute_modify("add", "flying_carpet", {"name": "x"})
    assert msg.startswith("❌")


def test_media_statuses_survive_personal_scope(clean_database, as_user):
    _enable("media")
    for title, status in [("A", "want"), ("B", "in_progress"), ("C", "finished"), ("D", "dropped")]:
        server.execute_modify("add", "media_item", {"title": title, "status": status})
    ctx = server.get_scoped_context("personal")["context"]
    titles = {i["title"] for i in ctx["media"]["items"]}
    assert titles == {"A", "B", "C"}  # dropped filtered, everything else visible


def test_media_section_scope_shows_dropped(clean_database, as_user):
    _enable("media")
    server.execute_modify("add", "media_item", {"title": "D", "status": "dropped"})
    ctx = server.get_scoped_context("media")["context"]
    assert {i["title"] for i in ctx["media"]["items"]} == {"D"}


def test_aesthetic_avoid_survives_personal_scope(clean_database, as_user):
    _enable("aesthetics")
    server.execute_modify("add", "aesthetic", {"name": "Corporate memphis", "stance": "avoid"})
    ctx = server.get_scoped_context("personal")["context"]
    assert ctx["aesthetics"]["styles"][0]["stance"] == "avoid"
