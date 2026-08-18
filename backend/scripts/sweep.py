"""Look over each persona for the inconsistencies nobody is present to notice.

Usage:
    python scripts/sweep.py             # every user
    python scripts/sweep.py --dry-run   # report, file nothing
    python scripts/sweep.py --user <id> # one user

Run it from cron, a systemd timer, or whatever the host already has. Reads
DATABASE_URL and the EMBEDDING_* env vars (.env supported via python-dotenv,
matching main.py).

WHY THIS EXISTS

Every other code path in MyGist is request-triggered, so nothing had ever run
while the user was elsewhere. That made the staleness marker on a read
self-defeating: it only fires when something reads the entity, and the entries
most likely to have gone stale are in the sections nothing reads.

WHAT IT MAY DO, AND WHAT IT MAY NOT

It files proposals. It does not write to the persona -- not once, not ever, and
tests/test_sweep.py asserts it. That is the entire reason an unattended process
is acceptable in a product whose promise is that nothing is inferred behind your
back: its only output is rows in the inbox the user already reviews, under the
same deduplication and the same permanent rejection as anything an agent
proposes.

Every check below is a mechanical inconsistency in the user's own data -- a date
that has passed, two entries that are nearly the same, a link pointing at
nothing. None of them is an inference about the person, which is the only kind of
thing a process running without them present has any business raising. There is
no LLM here, and it needs none.
"""

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import db  # noqa: E402
import persona_store  # noqa: E402
import proposals_store  # noqa: E402
import search_index  # noqa: E402
import sections  # noqa: E402
import settings_store  # noqa: E402

# The client label the user sees on every row this files, in the column that
# otherwise names an MCP client. "sweep" is honest: it was not an agent.
SWEEP_CLIENT = "sweep"

# Most a single run will file per user.
#
# A sweep over a long-neglected persona could otherwise produce ninety rows at
# once, and an inbox that arrives full is an inbox that gets abandoned -- which
# would take the review gate, and every other feature depending on it, with it.
# The rest wait for the next run; nothing is lost, because every check is
# recomputed from scratch each time.
PER_RUN_CAP = 12

# How close two entries in one section must be to be worth mentioning. Same
# threshold the write-time duplicate advisory uses, deliberately: "near enough
# to warn about" should not mean two different things in two places.
DUPLICATE_DISTANCE_CUTOFF = 0.4

# Where the last run is recorded, inside the existing per-user settings blob.
# Not a new table: this is one timestamp and a count.
SWEEP_KEY = "last_sweep"


def _note(findings, text, section_hint=None):
    findings.append({"text": text, "section_hint": section_hint})


# ---------------------------------------------------------------------------
# The checks. Each takes the loaded persona and appends plain-text findings.
# ---------------------------------------------------------------------------

def check_passed_target_dates(persona, findings):
    """A goal whose target date has gone by while it still says active.

    Goals-specific rather than manifest-driven, because `goals` is the only
    section with a target date to pass. Generalising it would mean inventing a
    vocabulary for "deadline field" to serve one caller.
    """
    today = date.today()
    for goal in (persona.get("goals") or {}).get("goals") or []:
        if not isinstance(goal, dict) or goal.get("status") != "active":
            continue
        raw = str(goal.get("target_date") or "")[:10]
        try:
            target = date.fromisoformat(raw)
        except ValueError:
            continue  # free text, or empty -- not a date that can have passed
        if target < today:
            _note(findings,
                  f'Goal "{goal.get("title")}" is still active but its target '
                  f'date ({raw}) passed {(today - target).days} days ago. '
                  f"Achieved, dropped, or does it need a new date?",
                  "goals")


def check_gone_quiet(user_id, findings):
    """Entries past their section's window that no agent has ever fetched.

    Two signals, not one. Age alone is a weak reason to suggest dropping
    something -- a preference set two years ago and read every week is settled,
    not stale. Age plus never-once-read is a real candidate.
    """
    windows = {key: spec.stale_after_days
               for key, spec in sections.SECTION_REGISTRY.items()
               if spec.stale_after_days}
    if not windows:
        return
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select file_type, entity_id, title,"
            "       (current_date - updated_at::date) as age_days"
            " from persona_search"
            " where user_id = %s and file_type = any(%s) and read_count = 0"
            " order by updated_at asc",
            (user_id, list(windows)),
        ).fetchall()
    for r in rows:
        if r["age_days"] > windows[r["file_type"]]:
            _note(findings,
                  f'"{r["title"]}" ({r["entity_id"]}) has not changed in '
                  f'{r["age_days"]} days and has never been read back. Still '
                  f"true, or has it had its day?",
                  r["file_type"])


def check_near_duplicates(user_id, findings):
    """Two entries in one section close enough to be the same thing.

    One self-join over the whole index rather than a probe per entity. Skipped
    entirely without pgvector: the FTS leg cannot express "close in meaning", and
    a title-word overlap heuristic here would file confident nonsense.

    ponytail: O(n^2) within each section, which is nothing at a persona's scale
    (tens to low hundreds of rows). Needs an ANN index only if that stops being
    true.
    """
    if not db.VECTOR_AVAILABLE:
        return
    with db.get_pool().connection() as conn:
        rows = conn.execute(
            "select a.file_type, a.entity_id as a_id, a.title as a_title,"
            "       b.entity_id as b_id, b.title as b_title,"
            "       (a.embedding <=> b.embedding) as dist"
            " from persona_search a"
            " join persona_search b"
            "   on b.user_id = a.user_id and b.file_type = a.file_type"
            "  and b.entity_id > a.entity_id"
            " where a.user_id = %s"
            "   and a.embedding is not null and b.embedding is not null"
            "   and (a.embedding <=> b.embedding) <= %s"
            " order by dist asc",
            (user_id, DUPLICATE_DISTANCE_CUTOFF),
        ).fetchall()
    for r in rows:
        _note(findings,
              f'"{r["a_title"]}" ({r["a_id"]}) and "{r["b_title"]}" '
              f'({r["b_id"]}) look like the same thing. Merge them, or link '
              f"them if they are genuinely separate?",
              r["file_type"])


def check_dangling_links(user_id, persona, findings):
    """A stored `related` id whose target has since been deleted.

    get_entity already surfaces these as {"id", "title": None} when something
    happens to read that entity. This is the same fact, reported without needing
    anyone to go looking.
    """
    links = []  # (holder_id, holder_title, target_id, file_type)
    for file_type, spec in sections.SECTION_REGISTRY.items():
        section_data = persona.get(file_type)
        if not isinstance(section_data, dict):
            continue
        for list_key, _prefix in spec.id_lists:
            for item in section_data.get(list_key) or []:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                for link in item.get("related") or []:
                    target = link.get("id") if isinstance(link, dict) else link
                    if target:
                        links.append((item["id"],
                                      item.get("name") or item.get("title") or item["id"],
                                      target, file_type))
    if not links:
        return
    resolved = search_index.resolve_titles(user_id, [t for _h, _ht, t, _f in links])
    for holder_id, holder_title, target, file_type in links:
        if target not in resolved:
            _note(findings,
                  f'"{holder_title}" ({holder_id}) links to {target}, which no '
                  f"longer exists. Drop the link?",
                  file_type)


# ---------------------------------------------------------------------------

def sweep_user(user_id: str, dry_run: bool = False, cap: int = PER_RUN_CAP) -> dict:
    """Every check for one user. Files at most `cap` proposals, writes nothing.

    Assumes db.current_user_id is already bound to `user_id` -- persona_store and
    proposals_store both read the contextvar rather than taking a parameter.
    """
    persona = {ft: persona_store.load(ft) for ft in persona_store.VALID_FILES}
    findings = []
    check_passed_target_dates(persona, findings)
    check_gone_quiet(user_id, findings)
    check_near_duplicates(user_id, findings)
    check_dangling_links(user_id, persona, findings)

    filed, suppressed, dropped = 0, 0, max(0, len(findings) - cap)
    if not dry_run:
        for finding in findings[:cap]:
            # kind="note" on purpose. A note is exactly what these are -- a line
            # of text for the user to act on -- and the inbox already renders,
            # bounds and promotes them. A bespoke kind would mean touching
            # validation, eviction and the frontend to gain nothing.
            outcome = proposals_store.create(
                "note",
                client=SWEEP_CLIENT,
                rationale="Found by the unattended sweep: an inconsistency "
                          "inside your own data, not an inference about you.",
                evidence="Nothing you said -- this comes from comparing your "
                         "persona against itself.",
                note=finding["text"],
                section_hint=finding["section_hint"],
            )
            if outcome["result"] == "stored":
                filed += 1
            else:
                # duplicate_pending (already waiting) or previously_rejected
                # (the user has settled this one, permanently).
                suppressed += 1

        blob = settings_store.get_settings()
        blob[SWEEP_KEY] = {"at": date.today().isoformat(),
                           "examined": len(findings), "filed": filed}
        settings_store.set_settings(blob)

    return {"user_id": str(user_id), "found": len(findings), "filed": filed,
            "suppressed": suppressed, "over_cap": dropped}


def sweep(dry_run: bool = False, only_user: str | None = None) -> list[dict]:
    db.ensure_vector_schema()
    with db.get_pool().connection() as conn:
        if only_user:
            users = [r["id"] for r in conn.execute(
                "select id from users where id = %s", (only_user,)).fetchall()]
        else:
            users = [r["id"] for r in conn.execute("select id from users").fetchall()]
    results = []
    for user_id in users:
        token = db.current_user_id.set(str(user_id))
        try:
            results.append(sweep_user(str(user_id), dry_run=dry_run))
        finally:
            db.current_user_id.reset(token)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would be filed, file nothing")
    parser.add_argument("--user", help="sweep one user id")
    args = parser.parse_args()
    try:
        for r in sweep(dry_run=args.dry_run, only_user=args.user):
            # Silence is the normal outcome and should look like it, but a run
            # that examined nothing and a run that never happened must not read
            # alike.
            print(f"{r['user_id']}: found={r['found']} filed={r['filed']} "
                  f"suppressed={r['suppressed']} over_cap={r['over_cap']}")
    finally:
        # Closed explicitly, or psycopg's pool prints four "couldn't stop
        # thread" warnings per run as the interpreter exits. This runs from
        # cron: eight lines of noise on every successful run is how a job's
        # output stops being read, and then a real failure goes unseen too.
        if db._pool is not None:
            db._pool.close()


if __name__ == "__main__":
    main()
