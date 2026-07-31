"""The proposals table exists after migration and survives a replay."""
import db


def _columns():
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select column_name, is_nullable from information_schema.columns"
            " where table_name = 'persona_proposals'"
        ).fetchall()
    return {r["column_name"]: r["is_nullable"] for r in rows}


def test_table_has_the_designed_columns(clean_database):
    cols = _columns()
    for name in (
        "id", "user_id", "kind", "action", "entity", "data", "note",
        "section_hint", "rationale", "evidence", "confidence", "proposed_by",
        "fingerprint", "status", "seen_count", "seen_at", "created_at",
        "resolved_at", "promoted_to",
    ):
        assert name in cols, f"missing column {name}"


def test_proposed_by_and_rationale_are_required(clean_database):
    cols = _columns()
    assert cols["proposed_by"] == "NO"
    assert cols["rationale"] == "NO"


def test_note_column_is_not_named_text(clean_database):
    assert "text" not in _columns()


def test_migration_is_replayable(clean_database, rerun_migrations):
    rerun_migrations()
    assert "fingerprint" in _columns()
