import pytest

import db


def test_create_user_returns_id_and_token():
    user_id, token = db.create_user("alice")
    assert user_id
    assert len(token) > 20


def test_create_user_rejects_duplicate_username():
    db.create_user("alice")
    with pytest.raises(db.DuplicateUsernameError):
        db.create_user("alice")


def test_resolve_token_finds_matching_user():
    user_id, token = db.create_user("alice")
    user = db.resolve_token(token)
    assert user is not None
    assert user["id"] == user_id
    assert user["username"] == "alice"


def test_resolve_token_rejects_unknown_token():
    assert db.resolve_token("not-a-real-token") is None


def test_resolve_token_rejects_wrong_token_for_real_user():
    db.create_user("alice")
    assert db.resolve_token("some-other-token") is None


def test_rotate_token_invalidates_old_token():
    user_id, old_token = db.create_user("alice")
    new_token = db.rotate_token(user_id)
    assert db.resolve_token(old_token) is None
    user = db.resolve_token(new_token)
    assert user["id"] == user_id
