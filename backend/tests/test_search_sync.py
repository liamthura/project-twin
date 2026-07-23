"""sync_index diffing + the persona_store.save hook. as_user fixture binds
db.current_user_id (see conftest)."""

import db
import embeddings
import persona_store
import search_index


def _rows(user_id, file_type="projects"):
    with db.get_pool().connection() as conn:
        return {
            r["entity_id"]: r
            for r in conn.execute(
                "select entity_id, title, text, content_hash, embedding is null as no_emb"
                " from persona_search where user_id = %s and file_type = %s",
                (user_id, file_type),
            ).fetchall()
        }


class FakeProvider:
    def __init__(self):
        self.calls = []

    def embed(self, texts, input_type="document"):
        self.calls.append((tuple(texts), input_type))
        return [[1.0] * db.EMBEDDING_DIM for _ in texts]


def test_sync_add_update_remove(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)  # FTS-only
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_aaaa1111", "name": "Alpha",
                          "description": "first"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data)
    rows = _rows(uid)
    assert rows["project_aaaa1111"]["title"] == "Alpha"
    first_hash = rows["project_aaaa1111"]["content_hash"]

    # unchanged: hash stays, no rewrite (updated_at equality is flaky; hash is the contract)
    search_index.sync_index(uid, "projects", data)
    assert _rows(uid)["project_aaaa1111"]["content_hash"] == first_hash

    # update
    data["projects"][0]["description"] = "second"
    search_index.sync_index(uid, "projects", data)
    assert _rows(uid)["project_aaaa1111"]["content_hash"] != first_hash

    # remove
    data["projects"] = []
    search_index.sync_index(uid, "projects", data)
    assert "project_aaaa1111" not in _rows(uid)


def test_sync_embeds_changed_rows_inline_with_provider(as_user, monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(embeddings, "get_provider", lambda: fake)
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_bbbb2222", "name": "Beta"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data, embed_sync=True)
    assert fake.calls and fake.calls[0][1] == "document"
    assert _rows(uid)["project_bbbb2222"]["no_emb"] is False


def test_embed_failure_leaves_null_embedding(as_user, monkeypatch):
    class Boom:
        def embed(self, texts, input_type="document"):
            raise embeddings.EmbeddingError("down")

    monkeypatch.setattr(embeddings, "get_provider", lambda: Boom())
    uid = db.current_user_id.get()
    data = {"projects": [{"id": "project_cccc3333", "name": "Gamma"}],
            "current_learning": [], "top_of_mind": []}
    search_index.sync_index(uid, "projects", data, embed_sync=True)  # must not raise
    assert _rows(uid)["project_cccc3333"]["no_emb"] is True


def test_persona_store_save_hooks_sync(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {"projects": [{"name": "Hooked"}],
                                    "current_learning": [], "top_of_mind": []})
    uid = db.current_user_id.get()
    rows = _rows(uid)
    assert len(rows) == 1  # id was assigned by save, then indexed
    assert list(rows.values())[0]["title"] == "Hooked"


def test_sync_failure_never_fails_save(as_user, monkeypatch):
    monkeypatch.setattr(search_index, "sync_index",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("index boom")))
    assert persona_store.save("projects", {"projects": [], "current_learning": [],
                                           "top_of_mind": []}) is True


def test_settings_row_not_indexed(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    import settings_store
    settings_store.set_disabled_sections([])
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        n = conn.execute(
            "select count(*) as n from persona_search where user_id = %s"
            " and file_type = '_settings'", (uid,),
        ).fetchone()["n"]
    assert n == 0
