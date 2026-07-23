"""Rebuild the persona_search index for every user.

Usage:
    python scripts/backfill_search_index.py             # index missing/changed
    python scripts/backfill_search_index.py --recreate  # drop + recreate the
        embedding column at the configured EMBEDDING_DIM, then re-embed all

Reads DATABASE_URL and the EMBEDDING_* env vars (.env supported via
python-dotenv, matching main.py).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import db  # noqa: E402
import persona_store  # noqa: E402
import search_index  # noqa: E402


def backfill(recreate=False):
    db.ensure_schema()
    if recreate and (db.VECTOR_AVAILABLE or _has_embedding_column()):
        with db.get_pool().connection() as conn:
            conn.execute("alter table persona_search drop column if exists embedding;")
            conn.execute(
                f"alter table persona_search add column embedding vector({db.EMBEDDING_DIM});"
            )
            conn.execute(
                "create index if not exists persona_search_embedding_idx"
                " on persona_search using hnsw (embedding vector_cosine_ops);"
            )
            conn.execute("update persona_search set content_hash = '';")  # force re-embed
        db.VECTOR_AVAILABLE = True
    with db.get_pool().connection() as conn:
        users = [r["id"] for r in conn.execute("select id from users").fetchall()]
    total = 0
    for user_id in users:
        token = db.current_user_id.set(str(user_id))
        try:
            for file_type in persona_store.VALID_FILES:
                data = persona_store.load(file_type)
                if isinstance(data, dict) and "error" not in data:
                    search_index.sync_index(str(user_id), file_type, data,
                                            embed_sync=True)
            with db.get_pool().connection() as conn:
                total += conn.execute(
                    "select count(*) as n from persona_search where user_id = %s",
                    (user_id,),
                ).fetchone()["n"]
        finally:
            db.current_user_id.reset(token)
    return total


def _has_embedding_column():
    with db.get_pool().connection() as conn:
        return conn.execute("""
            select 1 from information_schema.columns
            where table_name = 'persona_search' and column_name = 'embedding'
        """).fetchone() is not None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate", action="store_true",
                        help="drop + recreate the embedding column at EMBEDDING_DIM")
    args = parser.parse_args()
    n = backfill(recreate=args.recreate)
    print(f"Indexed {n} entities.")
