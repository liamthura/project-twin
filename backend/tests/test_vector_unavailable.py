"""FTS-only mode: pgvector missing must never fail startup (spec: self-hosted
vanilla Postgres)."""


def test_schema_without_pgvector(monkeypatch, rerun_migrations):
    import db

    monkeypatch.setattr(db, "_try_create_vector_extension", lambda conn: False)

    # Rebuild persona_search the way a vanilla instance would get it: the
    # migration creates the table and its FTS index, then ensure_vector_schema
    # declines to add the embedding column because the extension is absent.
    with db.get_pool().connection() as conn:
        conn.execute("drop table if exists persona_search;")
    rerun_migrations()
    db.ensure_vector_schema()

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
