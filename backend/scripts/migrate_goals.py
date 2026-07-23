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


def _legacy_entries(profile: dict) -> list[dict]:
    """Extract legacy goal entries as {"title", "notes"?} dicts. `notes` is
    populated from a dict item's `target` (or `deadline`) subfield — the
    frontend used to author goals_and_careers as {goal, target}, and that
    target must survive the move instead of being silently dropped."""
    entries = []
    for asp in profile.get("career_aspirations") or []:
        if isinstance(asp, str) and asp.strip():
            entries.append({"title": asp.strip()})
    for item in profile.get("goals_and_careers") or []:
        if isinstance(item, dict):
            title = item.get("title") or item.get("name") or item.get("goal")
            if title and str(title).strip():
                entry = {"title": str(title).strip()}
                target = item.get("target") or item.get("deadline")
                if target and str(target).strip():
                    entry["notes"] = f"target: {str(target).strip()}"
                entries.append(entry)
        elif isinstance(item, str) and item.strip():
            entries.append({"title": item.strip()})
    return entries


def _load_raw_profile(user_id) -> dict:
    """Read the profile blob straight off the persona_data row, bypassing
    persona_store's _normalize. As of the goals-pack cleanup, _normalize
    strips career_aspirations/goals_and_careers on every load — exactly the
    keys this migration needs to see — so persona_store.load("profile")
    would never surface them here. Mirrors settings_store's direct-row read."""
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, "profile"),
        ).fetchone()
    return row["data"] if row else {}


def migrate_user(user_id) -> dict:
    db.current_user_id.set(user_id)
    profile = _load_raw_profile(user_id)
    goals_blob = persona_store.load("goals")
    goals = goals_blob.setdefault("goals", [])
    existing = {g.get("title", "").lower() for g in goals if isinstance(g, dict)}

    moved = 0
    for entry in _legacy_entries(profile):
        title = entry["title"]
        if title.lower() in existing:
            continue
        goal = {"title": title, "type": "career", "status": "active"}
        if "notes" in entry:
            goal["notes"] = entry["notes"]
        goals.append(goal)
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
