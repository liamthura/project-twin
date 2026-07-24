"""One-off migration: fold Phase 5's retired legacy lists into their
consolidated shapes and drop the now-orphaned keys.

  - lifestyle.passions / lifestyle.curiosities -> lifestyle.interests
    (kind-tagged {"name", "kind": "passion"|"curiosity"}); lifestyle.references
    was dormant/unused and is dropped outright.
  - preferences.dislikes -> preferences.likes_dislikes
    (stance-tagged {"item", "stance": "dislike"}).
  - projects.current_learning -> goals.goals (type=learning, status=active,
    optional why <- context).
  - knowledge.proficiency_levels is dropped outright (no replacement).

Idempotent: existing interests/likes_dislikes/goals entries are skipped by
case-insensitive name/item/title match, and once the legacy keys are gone
reruns are no-ops.

Usage: DATABASE_URL=... python scripts/migrate_consolidation.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db  # noqa: E402
import persona_store  # noqa: E402


def _load_raw(user_id, file_type: str) -> dict:
    """Read a persona blob straight off the persona_data row, bypassing
    persona_store's _normalize. As of the consolidation cleanup, _normalize
    strips passions/curiosities/references (lifestyle), dislikes
    (preferences), current_learning (projects), and proficiency_levels
    (knowledge) on every load — exactly the keys this migration needs to
    see — so persona_store.load(file_type) would never surface them here.
    Mirrors migrate_goals' _load_raw_profile."""
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from persona_data where user_id = %s and file_type = %s",
            (user_id, file_type),
        ).fetchone()
    return row["data"] if row else {}


def _legacy_interest_name(item) -> str | None:
    """A legacy passions/curiosities item -> a bare name, or None if empty.
    Old dict-shaped entries used name/title/topic inconsistently; strings
    are used directly."""
    if isinstance(item, str):
        name = item.strip()
        return name or None
    if isinstance(item, dict):
        name = item.get("name") or item.get("title") or item.get("topic")
        if name and str(name).strip():
            return str(name).strip()
    return None


def _migrate_lifestyle(user_id) -> dict:
    lifestyle = _load_raw(user_id, "lifestyle")
    had_legacy = isinstance(lifestyle, dict) and (
        "passions" in lifestyle or "curiosities" in lifestyle or "references" in lifestyle
    )
    moved = 0
    if isinstance(lifestyle, dict):
        interests = lifestyle.setdefault("interests", [])
        existing = {i.get("name", "").lower() for i in interests if isinstance(i, dict)}
        for kind, key in (("passion", "passions"), ("curiosity", "curiosities")):
            for item in lifestyle.get(key) or []:
                name = _legacy_interest_name(item)
                if not name or name.lower() in existing:
                    continue
                interests.append({"name": name, "kind": kind})
                existing.add(name.lower())
                moved += 1
        lifestyle.pop("passions", None)
        lifestyle.pop("curiosities", None)
        lifestyle.pop("references", None)
    if moved or had_legacy:
        persona_store.save("lifestyle", lifestyle)
    return {"interests_moved": moved, "lifestyle_keys_popped": had_legacy}


def _migrate_preferences(user_id) -> dict:
    preferences = _load_raw(user_id, "preferences")
    had_legacy = isinstance(preferences, dict) and "dislikes" in preferences
    moved = 0
    if isinstance(preferences, dict):
        likes_dislikes = preferences.setdefault("likes_dislikes", [])
        existing = {ld.get("item", "").lower() for ld in likes_dislikes if isinstance(ld, dict)}
        for item in preferences.get("dislikes") or []:
            if not isinstance(item, str):
                continue
            text = item.strip()
            if not text or text.lower() in existing:
                continue
            likes_dislikes.append({"item": text, "stance": "dislike"})
            existing.add(text.lower())
            moved += 1
        preferences.pop("dislikes", None)
    if moved or had_legacy:
        persona_store.save("preferences", preferences)
    return {"likes_dislikes_moved": moved, "preferences_keys_popped": had_legacy}


def _migrate_projects(user_id) -> dict:
    projects = _load_raw(user_id, "projects")
    had_legacy = isinstance(projects, dict) and "current_learning" in projects
    moved = 0
    goals_changed = False
    goals_blob = None
    if isinstance(projects, dict) and projects.get("current_learning"):
        goals_blob = persona_store.load("goals")
        goals = goals_blob.setdefault("goals", [])
        existing = {g.get("title", "").lower() for g in goals if isinstance(g, dict)}
        for item in projects.get("current_learning") or []:
            title, why = None, None
            if isinstance(item, str):
                title = item.strip()
            elif isinstance(item, dict):
                raw_title = item.get("topic") or item.get("title") or item.get("name")
                title = str(raw_title).strip() if raw_title else None
                context = item.get("context") or item.get("why")
                if context and str(context).strip():
                    why = str(context).strip()
            if not title or title.lower() in existing:
                continue
            goal = {"title": title, "type": "learning", "status": "active"}
            if why:
                goal["why"] = why
            goals.append(goal)
            existing.add(title.lower())
            moved += 1
            goals_changed = True

    if isinstance(projects, dict):
        projects.pop("current_learning", None)
    if goals_changed:
        persona_store.save("goals", goals_blob)
    if had_legacy:
        persona_store.save("projects", projects)
    return {"goals_moved": moved, "projects_keys_popped": had_legacy}


def _migrate_knowledge(user_id) -> dict:
    knowledge = _load_raw(user_id, "knowledge")
    had_legacy = isinstance(knowledge, dict) and "proficiency_levels" in knowledge
    if isinstance(knowledge, dict):
        knowledge.pop("proficiency_levels", None)
    if had_legacy:
        persona_store.save("knowledge", knowledge)
    return {"knowledge_keys_popped": had_legacy}


def migrate_user(user_id) -> dict:
    db.current_user_id.set(user_id)
    stats = {}
    stats.update(_migrate_lifestyle(user_id))
    stats.update(_migrate_preferences(user_id))
    stats.update(_migrate_projects(user_id))
    stats.update(_migrate_knowledge(user_id))
    stats["moved"] = (
        stats["interests_moved"] + stats["likes_dislikes_moved"] + stats["goals_moved"]
    )
    return stats


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
    print(f"done — {summary['total']} entr(y/ies) migrated across {summary['users']} user(s), "
          f"{len(summary['failures'])} failure(s)")
    if summary["failures"]:
        for name, err in summary["failures"]:
            print(f"  FAILED {name}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
