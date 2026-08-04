"""The boot-time check that AUTH_ISSUER matches what the auth service signs.

No Node service is started. What is being pinned is the verdict and the message
-- the message *is* the feature here, since the module changes no behaviour and
exists only to put one line in a deploy log.

The distinction these guard hardest is mismatch versus undetermined. Reporting
"undetermined" as a mismatch would send someone to correct a setting that was
already right, which is worse than saying nothing.
"""

import asyncio
import logging

import httpx
import pytest

import auth_preflight
import auth_proxy
import jwt_auth

# Pure logic -- nothing here reads or writes a persona, so the per-test row
# wipe in conftest is dead weight. The marker only skips cleanup; it can
# never make a test wrong, only slower to forget.
pytestmark = pytest.mark.nodb


ADVERTISED = "https://mygist.example/auth"
METADATA_URL = f"http://auth.internal{auth_preflight._METADATA_PATH}"


@pytest.fixture
def configured(monkeypatch):
    """An instance with an auth service and an issuer set, agreeing by default.

    Both values are module globals frozen at import, so they are patched on the
    modules rather than in the environment -- setting AUTH_ISSUER here would
    change nothing that has already been read.
    """
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "http://auth.internal")
    monkeypatch.setattr(jwt_auth, "ISSUER", ADVERTISED)
    monkeypatch.setattr(jwt_auth, "MCP_RESOURCE", "https://mygist.example/mcp")


@pytest.fixture
def no_waiting(monkeypatch):
    """Collapse the retry backoff. Twenty seconds of real sleep in a unit test
    is twenty seconds nobody gets back."""

    async def instant(_seconds):
        return None

    monkeypatch.setattr(auth_preflight.asyncio, "sleep", instant)


def respond_with(monkeypatch, *responses):
    """Answer each metadata fetch with the next of `responses`, in order.

    Takes a sequence rather than one response so the retry path can be tested
    for what it is actually for: a service that is not up yet and then is.
    """
    remaining = list(responses)
    seen = []

    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            seen.append(url)
            outcome = remaining.pop(0) if remaining else remaining_last
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    remaining_last = responses[-1] if responses else None
    monkeypatch.setattr(auth_preflight.httpx, "AsyncClient", _Client)
    return seen


def metadata(issuer=ADVERTISED, status=200, body=None):
    if body is None:
        body = {"issuer": issuer} if issuer is not None else {}
    return httpx.Response(
        status,
        json=body,
        request=httpx.Request("GET", METADATA_URL),
    )


# --- the verdict -----------------------------------------------------------


def test_agreement_is_reported_at_info(configured, caplog):
    """A deploy log that says nothing cannot be distinguished from one where
    the check never ran, so agreement gets a line too."""
    with caplog.at_level(logging.INFO, logger=auth_preflight.__name__):
        assert auth_preflight.compare(ADVERTISED) is True

    assert caplog.records[0].levelno == logging.INFO
    assert ADVERTISED in caplog.text


def test_mismatch_names_both_values_and_the_fix(configured, monkeypatch, caplog):
    """The whole point of the module. Someone reading this line in a deploy log
    should not need to open anything else to act on it."""
    monkeypatch.setattr(jwt_auth, "ISSUER", "https://mygist.example")

    with caplog.at_level(logging.ERROR, logger=auth_preflight.__name__):
        assert auth_preflight.compare(ADVERTISED) is False

    message = caplog.records[0].getMessage()
    assert caplog.records[0].levelno == logging.ERROR
    # Both values, so the reader can see which one they set.
    assert "https://mygist.example" in message
    assert ADVERTISED in message
    # The fix, and the fact that a restart is not it.
    assert "AUTH_ISSUER" in message
    assert "recreate" in message


def test_a_trailing_path_difference_is_a_mismatch(configured, monkeypatch):
    """The exact failure this exists for: an issuer that is right except for
    the base path. String equality is the rule the API verifies with, so it is
    the rule this must check with -- anything cleverer here would pass a
    configuration the verifier then rejects."""
    monkeypatch.setattr(jwt_auth, "ISSUER", "https://mygist.example")
    assert auth_preflight.compare("https://mygist.example/auth") is False


def test_unset_issuer_prints_as_unset(configured, monkeypatch, caplog):
    """An empty string in a log line reads as a missing log line."""
    monkeypatch.setattr(jwt_auth, "ISSUER", "")

    with caplog.at_level(logging.ERROR, logger=auth_preflight.__name__):
        auth_preflight.compare(ADVERTISED)

    assert "(unset)" in caplog.records[0].getMessage()


# --- when there is nothing to compare --------------------------------------


def test_no_auth_service_means_no_check(configured, monkeypatch):
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "")
    assert auth_preflight.configured() is False


def test_no_issuer_means_no_check(configured, monkeypatch):
    """AUTH_ISSUER unset is a deliberate state -- JWT verification is off --
    not a mismatch to complain about."""
    monkeypatch.setattr(jwt_auth, "ISSUER", "")
    assert auth_preflight.configured() is False


def test_an_instance_without_oauth_is_not_nagged(configured, monkeypatch):
    """The document that advertises the issuer is part of the OAuth surface, so
    on an instance with OAuth off there is nothing to ask. Warning every boot
    that it could not check would be noise about a correct configuration -- and
    this is the default shape, so it would be most people's boot log."""
    monkeypatch.setattr(jwt_auth, "MCP_RESOURCE", "")
    assert auth_preflight.configured() is False


def test_unconfigured_run_touches_no_network(monkeypatch):
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "")

    def explode(**kwargs):
        raise AssertionError("an unconfigured check must not open a socket")

    monkeypatch.setattr(auth_preflight.httpx, "AsyncClient", explode)
    assert asyncio.run(auth_preflight.run()) is None


# --- fetching --------------------------------------------------------------


def test_run_agrees_against_a_live_document(configured, monkeypatch):
    seen = respond_with(monkeypatch, metadata())
    assert asyncio.run(auth_preflight.run()) is True
    assert seen == [METADATA_URL]


def test_run_reports_a_mismatch(configured, monkeypatch):
    monkeypatch.setattr(jwt_auth, "ISSUER", "https://mygist.example")
    respond_with(monkeypatch, metadata())
    assert asyncio.run(auth_preflight.run()) is False


def test_a_service_that_starts_late_is_still_checked(
    configured, no_waiting, monkeypatch
):
    """The two containers start together and this one is often first. An auth
    service that is refusing connections for the first few seconds is the
    ordinary case, not a fault."""
    seen = respond_with(
        monkeypatch,
        httpx.ConnectError("connection refused"),
        httpx.ConnectError("connection refused"),
        metadata(),
    )

    assert asyncio.run(auth_preflight.run()) is True
    assert len(seen) == 3


# --- undetermined is not failure -------------------------------------------


def test_unreachable_never_claims_a_mismatch(
    configured, no_waiting, monkeypatch, caplog
):
    """Nothing was compared, so nothing can be said to disagree. Reporting this
    as a mismatch would send someone to change a correct setting."""
    respond_with(monkeypatch, httpx.ConnectError("connection refused"))

    with caplog.at_level(logging.INFO, logger=auth_preflight.__name__):
        assert asyncio.run(auth_preflight.run()) is None

    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "mismatch" not in caplog.text
    assert "could not verify" in caplog.text


def test_a_persistent_404_names_the_other_half_of_the_setting(
    configured, no_waiting, monkeypatch, caplog
):
    """The service answered, and what it said was that it has no OAuth
    endpoints -- AUTH_MCP_RESOURCE set here and not there. That is a real
    diagnosis, and a different one from a mismatch: the issuer is never
    compared, so it is never accused."""
    respond_with(monkeypatch, metadata(status=404))

    with caplog.at_level(logging.INFO, logger=auth_preflight.__name__):
        assert asyncio.run(auth_preflight.run()) is None

    message = caplog.records[0].getMessage()
    assert caplog.records[0].levelno == logging.ERROR
    assert "AUTH_MCP_RESOURCE" in message
    assert "auth container" in message
    assert "mismatch" not in message
    assert "AUTH_ISSUER" not in message


def test_metadata_without_an_issuer_is_undetermined(
    configured, no_waiting, monkeypatch
):
    respond_with(monkeypatch, metadata(issuer=None))
    assert asyncio.run(auth_preflight.run()) is None


def test_a_non_json_body_is_undetermined(configured, no_waiting, monkeypatch):
    """A reverse proxy's HTML error page, most likely."""
    html = httpx.Response(
        200,
        content=b"<html>502 Bad Gateway</html>",
        headers={"content-type": "text/html"},
        request=httpx.Request("GET", METADATA_URL),
    )
    respond_with(monkeypatch, html)
    assert asyncio.run(auth_preflight.run()) is None


# --- the task ---------------------------------------------------------------


def test_start_is_a_no_op_when_unconfigured(monkeypatch):
    monkeypatch.setattr(auth_proxy, "SERVICE_URL", "")

    async def scenario():
        auth_preflight.start()
        assert auth_preflight._task is None

    asyncio.run(scenario())


def test_the_check_runs_detached_and_stops_cleanly(configured, monkeypatch):
    """Startup must not wait twenty seconds for a diagnostic, and shutdown must
    not leave a task still retrying against a closed loop."""
    respond_with(monkeypatch, metadata())

    async def scenario():
        auth_preflight.start()
        task = auth_preflight._task
        assert task is not None and not task.done()

        await task
        auth_preflight.stop()
        assert auth_preflight._task is None

    try:
        asyncio.run(scenario())
    finally:
        auth_preflight._task = None


def test_a_check_still_retrying_at_shutdown_is_cancelled(configured, monkeypatch):
    """A real deploy that fails fast: the container stops before twenty seconds
    of retries are up."""
    respond_with(monkeypatch, httpx.ConnectError("connection refused"))

    async def scenario():
        auth_preflight.start()
        task = auth_preflight._task
        # Let it reach the first sleep, so there is something to cancel.
        await asyncio.sleep(0)
        auth_preflight.stop()
        assert task.cancelled() or task.cancelling()

    try:
        asyncio.run(scenario())
    finally:
        auth_preflight._task = None


def test_an_unexpected_failure_does_not_escape_the_task(configured, monkeypatch):
    """A detached task that raises prints "Task exception was never retrieved"
    at some later collection -- a confusing thing to emit during a deploy, from
    a check whose entire purpose is to make a deploy less confusing."""

    async def boom():
        raise RuntimeError("something no one anticipated")

    monkeypatch.setattr(auth_preflight, "run", boom)

    async def scenario():
        auth_preflight.start()
        await auth_preflight._task
        assert auth_preflight._task.exception() is None

    try:
        asyncio.run(scenario())
    finally:
        auth_preflight._task = None
