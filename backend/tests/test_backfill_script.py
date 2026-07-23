import db
import embeddings
import persona_store


def test_backfill_indexes_all_users(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    persona_store.save("projects", {
        "projects": [{"name": "Alpha"}], "current_learning": [], "top_of_mind": []})
    uid = db.current_user_id.get()
    with db.get_pool().connection() as conn:
        conn.execute("delete from persona_search where user_id = %s", (uid,))

    from scripts.backfill_search_index import backfill
    n = backfill()
    assert n >= 1
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select entity_id from persona_search where user_id = %s", (uid,)
        ).fetchall()
    assert len(rows) == 1


def test_backfill_recreate_resets_embedding_column(as_user, monkeypatch):
    monkeypatch.setattr(embeddings, "get_provider", lambda: None)
    from scripts.backfill_search_index import backfill
    backfill(recreate=True)  # must not raise; column recreated at db.EMBEDDING_DIM
    with db.get_pool().connection() as conn:
        row = conn.execute("""
            select atttypmod as dim from pg_attribute
            where attrelid = 'persona_search'::regclass and attname = 'embedding'
        """).fetchone()
    assert row["dim"] == db.EMBEDDING_DIM
