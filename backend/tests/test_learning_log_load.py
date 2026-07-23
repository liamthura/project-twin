from datetime import datetime, timedelta, timezone

import server

_filt = server._filter_learning_log_by_time


def _z(dt):
    """Format an aware datetime as a Z-suffixed UTC ISO string."""
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entries():
    # Timestamps are relative to now so the days-window tests never expire.
    now = datetime.now(timezone.utc)
    return {"entries": [
        {"id": "learn_1", "timestamp": _z(now - timedelta(days=400))},                    # oldest, Z UTC
        {"id": "learn_2", "timestamp": (now - timedelta(days=200)).replace(tzinfo=None).isoformat()},  # naive micros
        {"id": "learn_3", "timestamp": _z(now - timedelta(days=5))},                       # newest, inside 30d
        {"id": "learn_4"},                                                                 # missing ts
    ]}

def test_limit_returns_newest_not_oldest():
    out = _filt(_entries(), days=None, limit=2)
    ids = [e["id"] for e in out["entries"]]
    assert ids == ["learn_3", "learn_2"]     # newest first

def test_mixed_timestamp_formats_parse():
    out = _filt(_entries(), days=3650, limit=None)   # ~10y window keeps all dated
    assert {e["id"] for e in out["entries"]} >= {"learn_1", "learn_2", "learn_3"}

def test_missing_timestamp_does_not_lead_recency_view():
    out = _filt(_entries(), days=30, limit=None)
    ids = [e["id"] for e in out["entries"]]
    assert "learn_4" not in ids                # fully excluded, not just off the front
    assert ids[0] != "learn_4"


def _wrapped():
    return {"learning_log": _entries(), "profile": {"name": "A"}}

def test_wrapped_shape_returns_newest_and_preserves_siblings():
    out = _filt(_wrapped(), days=None, limit=2)
    ids = [e["id"] for e in out["learning_log"]["entries"]]
    assert ids == ["learn_3", "learn_2"]              # newest first
    assert out["profile"] == {"name": "A"}            # sibling survives untouched

def test_wrapped_shape_missing_timestamp_fails_closed():
    out = _filt(_wrapped(), days=30, limit=None)
    ids = [e["id"] for e in out["learning_log"]["entries"]]
    assert "learn_4" not in ids                       # fully excluded by date window
