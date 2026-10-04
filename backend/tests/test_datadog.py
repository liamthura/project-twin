"""Datadog is opt-in: DD_AGENT_HOST switches tracing and JSON logs on, and
without it the app behaves exactly as before.

The switch is checked in a subprocess because ddtrace registers a pytest
plugin, so `ddtrace` is already in this process's sys.modules either way.
"""

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent

# uvicorn configures its own loggers before it imports the app; do the same.
PROBE = (
    "import logging.config, uvicorn.config;"
    "logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG);"
    "import logging, sys, main, server;"
    "print('ddtrace.auto' in sys.modules,"
    " type(logging.getLogger().handlers[0].formatter).__name__,"
    " logging.getLogger('uvicorn').propagate, flush=True);"
    # Skip the unclosed db pool's 5s-per-thread wait at interpreter exit.
    "import os; os._exit(0)"
)


def _probe(**env):
    base = {k: v for k, v in os.environ.items() if not k.startswith("DD_")}
    out = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=BACKEND, env={**base, **env}, capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    return out.stdout.split()


@pytest.mark.nodb
def test_off_by_default():
    assert _probe() == ["False", "Formatter", "False"]


@pytest.mark.nodb
def test_on_with_agent_host():
    # Nothing listens on this port; ddtrace only fails to flush, quietly.
    assert _probe(DD_AGENT_HOST="127.0.0.1", DD_TRACE_AGENT_PORT="1") == [
        "True", "JsonFormatter", "True",
    ]


@pytest.mark.nodb
def test_json_formatter():
    from server import JsonFormatter

    fmt = JsonFormatter()
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "hi %s", ("there",), None)
    plain = json.loads(fmt.format(record))
    assert plain["message"] == "hi there"
    assert plain["level"] == "INFO" and plain["logger"] == "x"
    assert "dd.trace_id" not in plain and "error.stack" not in plain

    setattr(record, "dd.trace_id", "123")
    setattr(record, "dd.span_id", "456")
    assert json.loads(fmt.format(record))["dd.trace_id"] == "123"

    try:
        raise ValueError("boom")
    except ValueError:
        record.exc_info = sys.exc_info()
    assert "ValueError: boom" in json.loads(fmt.format(record))["error.stack"]
