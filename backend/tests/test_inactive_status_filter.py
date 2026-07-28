"""Context filtering by status.

`_filter_inactive` used an allow-list of active statuses, so any status not on
it was dropped from context. Adding a status value to a manifest therefore hid
those items from every AI client silently. That is what happened to `idea`:
it replaced `planning` on projects, `planning` was allow-listed, `idea` was
not, and every idea-stage project became invisible -- and because the filter
drops a field entirely when nothing survives, a user whose projects were all
ideas appeared to have none at all.

These tests pin the inverted behaviour: a deny-list, so an unanticipated
status defaults to visible.
"""
import json
import pathlib

import pytest

import server


def _statuses_declared_in_manifests():
    """Every `status` value any shipped manifest declares.

    Read from disk rather than hardcoded: a status added to a manifest must
    show up here, which is the drift this whole module exists to catch.
    """
    packs = pathlib.Path(server.__file__).parent / "section_packs"
    found = {}
    for manifest in sorted(packs.glob("*/manifest.json")):
        data = json.loads(manifest.read_text())
        for entity_name, entity in (data.get("entities") or {}).items():
            values = (entity.get("valid_values") or {}).get("status")
            for value in values or []:
                found.setdefault(value, set()).add(f"{data['key']}.{entity_name}")
    return found


def test_idea_stage_projects_are_visible_in_context(as_user):
    """The regression. An idea is the earliest active stage, not an inactive one."""
    server.execute_modify("add", "project", {"name": "Ship the docs site", "description": "d", "status": "idea"})

    ctx = server.get_scoped_context("professional")["context"]
    names = [p["name"] for p in ctx.get("projects", {}).get("projects", [])]

    assert "Ship the docs site" in names


def test_a_user_whose_projects_are_all_ideas_still_has_a_projects_section(as_user):
    """The filter deletes a field when nothing survives it, and the section when
    no field survives -- so hiding the only status a user uses made them look
    like they had no projects at all, rather than like they had hidden ones."""
    server.execute_modify("add", "project", {"name": "Only idea", "description": "d", "status": "idea"})

    ctx = server.get_scoped_context("professional")["context"]

    assert "projects" in ctx, "the whole projects section vanished"
    assert ctx["projects"]["projects"], "the projects list vanished"


def test_genuinely_inactive_projects_stay_hidden(as_user):
    """The inversion must not turn the filter off. `paused` and `archived` mean
    what the docstring says they mean."""
    server.execute_modify("add", "project", {"name": "Live one", "description": "d", "status": "active"})
    server.execute_modify("add", "project", {"name": "Parked", "description": "d", "status": "paused"})
    server.execute_modify("add", "project", {"name": "Old", "description": "d", "status": "archived"})

    ctx = server.get_scoped_context("professional")["context"]
    names = [p["name"] for p in ctx["projects"]["projects"]]

    assert "Live one" in names
    assert "Parked" not in names
    assert "Old" not in names


def test_an_unrecognised_status_defaults_to_visible(as_user):
    """The point of the inversion. Nothing in the codebase declares `prototyping`;
    under the old allow-list it would have been dropped without a word."""
    server.execute_modify("add", "project", {"name": "Novel status", "description": "d", "status": "prototyping"})

    ctx = server.get_scoped_context("professional")["context"]
    names = [p["name"] for p in ctx["projects"]["projects"]]

    assert "Novel status" in names


def test_an_item_with_no_status_is_visible(as_user):
    """Most entities carry no status at all; they must not be filtered."""
    server.execute_modify("add", "connection", {"name": "Ada Lovelace"})

    ctx = server.get_scoped_context("personal")["context"]
    names = [c["name"] for c in ctx["circle"]["connections"]]

    assert "Ada Lovelace" in names


# Statuses reviewed and deliberately left visible. Kept here rather than in
# server.py because it constrains nothing at runtime -- its only job is to make
# the parametrized test below fail when a manifest gains a status nobody has
# classified. Checking `status in INACTIVE_STATUSES` alone could not do that:
# the answer is always True or False, so the assertion could never fail.
REVIEWED_VISIBLE = frozenset({
    "active",
    "completed",
    "finished",
    "idea",          # the regression this module exists for
    "in_progress",
    "open",
    "want",
})


@pytest.mark.parametrize("status", sorted(_statuses_declared_in_manifests()))
def test_every_declared_status_has_been_classified(status):
    """Guards the drift that caused the bug.

    Every status a manifest declares must be deliberately hidden or
    deliberately shown. What is not allowed is a status nobody considered --
    which under the old allow-list silently meant "hidden".

    To fail this: add a status to any manifest's `valid_values.status` and
    classify it in neither set.
    """
    declared_by = sorted(_statuses_declared_in_manifests()[status])
    hidden = status in server.INACTIVE_STATUSES
    shown = status in REVIEWED_VISIBLE

    assert hidden or shown, (
        f"status {status!r} (declared by {declared_by}) is unclassified. "
        f"Add it to server.INACTIVE_STATUSES to hide it from context, or to "
        f"REVIEWED_VISIBLE here to confirm it should be shown."
    )
    assert not (hidden and shown), (
        f"status {status!r} is in both INACTIVE_STATUSES and REVIEWED_VISIBLE"
    )
