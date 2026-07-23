"""One-off migration: move profile.career_aspirations and the dormant
profile.goals_and_careers into the goals section as goal entities
(type=career, status=active). Idempotent: existing goal titles are skipped
(case-insensitive), and once the profile keys are gone reruns are no-ops.

Usage: DATABASE_URL=... python scripts/migrate_goals.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db  # noqa: E402
import persona_store  # noqa: E402


def _legacy_titles(profile: dict) -> list[str]:
    titles = []
    for asp in profile.get("career_aspirations") or []:
        if isinstance(asp, str) and asp.strip():
            titles.append(asp.strip())
    for item in profile.get("goals_and_careers") or []:
        if isinstance(item, dict):
            t = item.get("title") or item.get("name") or item.get("goal")
            if t and str(t).strip():
                titles.append(str(t).strip())
        elif isinstance(item, str) and item.strip():
            titles.append(item.strip())
    return titles


def migrate_user(user_id) -> dict:
    db.current_user_id.set(user_id)
    profile = persona_store.load("profile")
    goals_blob = persona_store.load("goals")
    goals = goals_blob.setdefault("goals", [])
    existing = {g.get("title", "").lower() for g in goals if isinstance(g, dict)}

    moved = 0
    for title in _legacy_titles(profile):
        if title.lower() in existing:
            continue
        goals.append({"title": title, "type": "career", "status": "active"})
        existing.add(title.lower())
        moved += 1

    had_legacy_keys = "career_aspirations" in profile or "goals_and_careers" in profile
    profile.pop("career_aspirations", None)
    profile.pop("goals_and_careers", None)

    if moved:
        persona_store.save("goals", goals_blob)
    if had_legacy_keys:
        persona_store.save("profile", profile)
    return {"moved": moved}


def run_all(users) -> dict:
    """Migrate every user row; one user's failure never blocks the rest."""
    total, failures = 0, []
    for row in users:
        try:
            stats = migrate_user(row["id"])
            total += stats["moved"]
            print(f"{row['username']}: moved {stats['moved']}")
        except Exception as exc:  # noqa: BLE001 — batch isolation over one-shot prod data
            failures.append((row["username"], repr(exc)))
            print(f"{row['username']}: FAILED — {exc!r}")
    return {"total": total, "users": len(users), "failures": failures}


def main():
    with db.get_pool().connection() as conn:
        users = conn.execute("select id, username from users").fetchall()
    summary = run_all(users)
    print(f"done — {summary['total']} goal(s) migrated across {summary['users']} user(s), "
          f"{len(summary['failures'])} failure(s)")
    if summary["failures"]:
        for name, err in summary["failures"]:
            print(f"  FAILED {name}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
