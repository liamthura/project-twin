import db
import persona_store as store
from sections import SECTION_REGISTRY

# `as_user` fixture is provided by tests/conftest.py


def test_load_unknown_file_returns_default(as_user):
    data = store.load("profile")
    assert data == SECTION_REGISTRY["profile"].default


def test_save_then_load_round_trips(as_user):
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Alice"})
    assert store.load("profile")["name"] == "Alice"


def test_data_is_isolated_per_user():
    with db.get_pool().connection() as conn:
        row_a = conn.execute(
            "insert into users (username, token_hash) values ('a', 'ta') returning id"
        ).fetchone()
        row_b = conn.execute(
            "insert into users (username, token_hash) values ('b', 'tb') returning id"
        ).fetchone()

    token_a = db.current_user_id.set(str(row_a["id"]))
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Alice"})
    db.current_user_id.reset(token_a)

    token_b = db.current_user_id.set(str(row_b["id"]))
    store.save("profile", {**SECTION_REGISTRY["profile"].default, "name": "Bob"})
    assert store.load("profile")["name"] == "Bob"
    db.current_user_id.reset(token_b)

    token_a2 = db.current_user_id.set(str(row_a["id"]))
    assert store.load("profile")["name"] == "Alice"
    db.current_user_id.reset(token_a2)


def test_get_all_returns_every_file_type(as_user):
    all_data = store.get_all()
    assert set(all_data.keys()) == set(store.VALID_FILES)
