#!/usr/bin/env python3
"""
One-off: load existing mygist_data/*.json files into Neon/Postgres under a
newly-registered user account, backfilling stable entity IDs as it goes.

Usage:
    python scripts/migrate_json_to_postgres.py --username <you> [--data-dir ../../mygist_data]

Requires DATABASE_URL to point at the target (real Neon) database.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import db
import persona_store
from server import generate_entity_id

ENTITY_LISTS_NEEDING_IDS = {
    "knowledge": [("domains", "domain")],
    "lifestyle": [("hobbies", "hobby")],
    "projects": [("projects", "project")],
    "circle": [("connections", "connection")],
}


def backfill_ids(file_type: str, data: dict) -> dict:
    for list_key, prefix in ENTITY_LISTS_NEEDING_IDS.get(file_type, []):
        for item in data.get(list_key, []):
            if isinstance(item, dict):
                item.setdefault("id", generate_entity_id(prefix))
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--data-dir", default=str(Path(__file__).parent.parent.parent / "mygist_data"))
    args = parser.parse_args()

    db.ensure_schema()
    user_id, token = db.create_user(args.username)

    reset_token = db.current_user_id.set(user_id)
    data_dir = Path(args.data_dir)
    migrated = []
    for file_type in persona_store.VALID_FILES:
        path = data_dir / f"{file_type}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        data = backfill_ids(file_type, data)
        persona_store.save(file_type, data)
        migrated.append(file_type)
    db.current_user_id.reset(reset_token)

    print(f"Created user '{args.username}' (id={user_id})")
    print(f"Migrated: {', '.join(migrated) or '(none found)'}")
    print(f"\nYOUR TOKEN (save this now, it will not be shown again):\n{token}\n")


if __name__ == "__main__":
    main()
