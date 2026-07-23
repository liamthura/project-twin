"""FTS-only mode: pgvector missing must never fail startup (spec: self-hosted
vanilla Postgres)."""


def test_schema_without_pgvector(monkeypatch):
    import db

    monkeypatch.setattr(db, "_try_create_vector_extension", lambda conn: False)
    # Rebuild from scratch as ensure_schema would on a vanilla instance
    with db.get_pool().connection() as conn:
        conn.execute("drop table if exists persona_search;")
    db.ensure_schema()
    assert db.VECTOR_AVAILABLE is False
    with db.get_pool().connection() as conn:
        cols = {
            r["column_name"]
            for r in conn.execute(
                "select column_name from information_schema.columns"
                " where table_name = 'persona_search'"
            ).fetchall()
        }
    assert "embedding" not in cols
    assert "tsv" in cols
