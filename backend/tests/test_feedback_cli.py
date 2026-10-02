"""Reading feedback where the database is: list, show, done."""
import pytest

import feedback_store as fb
from scripts import feedback as cli
from tests.test_feedback import JPEG, account


def test_list_shows_open_reports_and_done_hides_them(capsys):
    user_id, _ = account("cli-sam")
    first = fb.save(user_id, "problem", "Save failed\nmore", {}, None, None)
    fb.save(user_id, "idea", "Dark mode for print", {}, JPEG, "jpeg")

    cli.main([])
    out = capsys.readouterr().out
    assert "Save failed" in out and "more" not in out
    assert "Dark mode for print [image]" in out and "cli-sam" in out

    cli.main(["done", str(first)])
    assert f"Report {first} is handled." in capsys.readouterr().out
    cli.main([])
    assert "Save failed" not in capsys.readouterr().out

    cli.main(["--all"])
    assert "Save failed" in capsys.readouterr().out


def test_show_prints_it_and_writes_the_screenshot(tmp_path, capsys):
    user_id, _ = account("cli-ada", "ada@example.com")
    report_id = fb.save(user_id, "idea", "Dark mode", {"page": "#/profile"}, JPEG, "jpeg")
    cli.main(["show", str(report_id), "--out", str(tmp_path)])
    out = capsys.readouterr().out
    assert "From: cli-ada (ada@example.com)" in out and "Page: #/profile" in out
    assert (tmp_path / f"feedback-{report_id}.jpg").read_bytes() == JPEG


def test_unknown_ids_fail_loudly():
    with pytest.raises(SystemExit, match="No report 999"):
        cli.main(["show", "999"])
    with pytest.raises(SystemExit, match="No open report 999"):
        cli.main(["done", "999"])
