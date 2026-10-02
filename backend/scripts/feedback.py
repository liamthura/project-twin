#!/usr/bin/env python3
"""Reading feedback: what people sent from the island.

Run where the database is reachable -- in the container, where DATABASE_URL
already is. Same gate as access.py, for the same reason: database access is a
stronger lock than any admin screen this project would have to build.

    python scripts/feedback.py              open reports, newest first
    python scripts/feedback.py --all        handled ones too
    python scripts/feedback.py show 42      one in full; writes feedback-42.jpg if it has one
    python scripts/feedback.py done 42      mark it handled

Each report is also emailed to FEEDBACK_TO as it arrives. This is the record
for when a send failed, or the email is long gone.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import feedback_store  # noqa: E402
from scripts.access import hint, table  # noqa: E402


def first_line(message: str, width: int = 50) -> str:
    line = message.strip().splitlines()[0]
    return line if len(line) <= width else line[: width - 1] + "…"


def list_reports(show_all: bool) -> None:
    rows = feedback_store.list_reports(include_handled=show_all)
    if not rows:
        print("\n  No feedback yet." if show_all else "\n  No open feedback.")
        return
    table(
        ["ID", "WHEN", "KIND", "FROM", "MESSAGE"],
        [
            [
                str(r["id"]),
                r["created_at"].strftime("%Y-%m-%d %H:%M"),
                feedback_store.KIND_LABELS[r["kind"]] + (" (handled)" if r["handled_at"] else ""),
                r["username"],
                first_line(r["message"]) + (" [image]" if r["has_screenshot"] else ""),
            ]
            for r in rows
        ],
    )
    hint("Read one: feedback.py show <id>", "Mark it handled: feedback.py done <id>")


def show(report_id: int, out: str) -> None:
    report = feedback_store.get_report(report_id)
    if report is None:
        raise SystemExit(f"No report {report_id}.")
    subject, text = feedback_store.email_for(report, feedback_store.sender(report["user_id"]))
    print(f"\n  {subject}\n")
    for line in text.split("\n"):
        print(f"  {line}" if line else "")
    if report["screenshot"] is not None:
        path = Path(out) / feedback_store.screenshot_name(report)
        path.write_bytes(bytes(report["screenshot"]))
        print(f"\n  Screenshot: {path}")


def done(report_id: int) -> None:
    if not feedback_store.mark_handled(report_id):
        raise SystemExit(f"No open report {report_id}.")
    print(f"\n  Report {report_id} is handled.")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Read the feedback people sent.")
    parser.add_argument("--all", action="store_true", help="include handled reports")
    commands = parser.add_subparsers(dest="command")
    show_cmd = commands.add_parser("show", help="one report in full")
    show_cmd.add_argument("id", type=int)
    show_cmd.add_argument("--out", default=".", help="where to write its screenshot")
    done_cmd = commands.add_parser("done", help="mark a report handled")
    done_cmd.add_argument("id", type=int)
    args = parser.parse_args(argv)

    if args.command == "show":
        show(args.id, args.out)
    elif args.command == "done":
        done(args.id)
    else:
        list_reports(args.all)


if __name__ == "__main__":
    try:
        main()
    finally:
        # As in access.py: left open, the pool's worker threads each take five
        # seconds to give up on the way out, burying what was just printed.
        db.get_pool().close()
