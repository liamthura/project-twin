"""`frontend/src/__fixtures__/packs.json` still agrees with the manifests.

WHAT THIS GUARDS. The fixture is generated from `backend/section_packs/*/manifest.json`
by `frontend/scripts/generate-pack-fixtures.mjs` (`npm run fixtures`), and 43 of
the frontend's test files load it. Every claim that suite makes about a real
pack -- what a row renders, which fields sit in the form, what `promotionTargets`
offers -- is a claim about this file, and is worth exactly as much as its
agreement with the manifests it came from.

WHY IT NEEDS A GUARD. Nothing in either test suite noticed when they disagreed.
At `6a3069c` eight manifests changed and the whole frontend suite -- 837 tests --
passed against the stale fixture before anyone regenerated it. The workflow does
check (`.github/workflows/ci.yml`, "Check pack fixtures are current" regenerates
and diffs), so this was never going to reach main unnoticed, but that check runs
after a push, in the frontend job, and reports a raw `git diff` rather than what
went wrong. This puts the failure in the loop where the manifest was edited:
`pytest` is step 5 of CONTRIBUTING-PACKS' checklist and `npm run fixtures` is
step 6, so a stale fixture now fails one step before the command that fixes it.

WHY IT LIVES IN THE BACKEND SUITE. `entities` is derived by
`pack_loader.derive_entities`, in Python, and it is the one key in the fixture
that no JS reader can recompute -- so a frontend guard would have a blind spot
over precisely the key the frontend alone consumes (`ProposalsPanel`'s
`promotionTargets`). It is also the manifests that move: the fixture is
downstream of them and never changes on its own.

The projection below is a second statement of the generator's `.map()`, and that
is deliberate rather than unavoidable: the alternative -- running the generator
from a test and diffing -- needs Node in the backend job, which the workflow does
not install. The cost is that adding a key to the generator fails here too. That
is the right outcome; the fixture's shape is what the frontend renders from.
"""
import json
from pathlib import Path

import pack_loader

FIXTURE = Path(__file__).parents[2] / "frontend" / "src" / "__fixtures__" / "packs.json"

STALE = (
    "packs.json disagrees with the manifests -- run `npm run fixtures` in frontend/. "
    "Until you do, every frontend test that reads a real pack is checking data the "
    "backend no longer serves."
)

# `enabled` is the one value in the fixture that comes from nowhere in a manifest:
# the generator hardcodes true, so the fixture represents the all-enabled state.
# Asserted rather than skipped, so a generator that started deriving it fails here.
ALWAYS_ENABLED = True


def _expected() -> list[dict]:
    """What `generate-pack-fixtures.mjs` emits, rebuilt from the manifests.

    Mirrors that script step for step: skip a directory whose name starts with `_`
    or that holds no manifest.json, project eight keys, then sort by position and
    key. Reads each file directly rather than going through `manifests()`, so the
    comparison does not depend on the loader's cache being cold.
    """
    packs = []
    for entry in sorted(pack_loader.PACKS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        path = entry / "manifest.json"
        if not path.exists():
            continue
        m = json.loads(path.read_text())
        packs.append(
            {
                "key": m["key"],
                "title": m["title"],
                "description": m["description"],
                "core": m.get("core", False),
                "default_enabled": m.get("default_enabled", True),
                "enabled": ALWAYS_ENABLED,
                "entities": pack_loader.derive_entities(m),
                "sections": m["sections"],
                "_position": m.get("position", 999),
            }
        )
    packs.sort(key=lambda p: (p["_position"], p["key"]))
    return [{k: v for k, v in p.items() if k != "_position"} for p in packs]


def _actual() -> list[dict]:
    return json.loads(FIXTURE.read_text())


def test_the_fixture_lists_the_same_packs_in_the_same_order():
    # Order is load-bearing: the fixture mirrors what /api/settings serves, and
    # the sidebar's section order is `position` then key.
    assert [p["key"] for p in _actual()] == [p["key"] for p in _expected()], STALE


def test_every_pack_in_the_fixture_matches_its_manifest():
    actual = {p["key"]: p for p in _actual()}
    for expected in _expected():
        key = expected["key"]
        assert key in actual, f"{STALE} ('{key}' is missing from the fixture)"
        for name, value in expected.items():
            assert actual[key].get(name) == value, f"{STALE} (pack '{key}', key '{name}')"


def test_the_fixture_carries_exactly_the_keys_the_generator_emits():
    # A ninth key would mean the generator grew one and this file did not, which
    # makes the comparison above partial without saying so.
    for pack in _actual():
        assert set(pack) == {
            "key",
            "title",
            "description",
            "core",
            "default_enabled",
            "enabled",
            "entities",
            "sections",
        }, f"{STALE} (pack '{pack.get('key')}' has an unexpected key set)"
