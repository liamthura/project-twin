"""whoami reports the connection, not the persona.

The interesting half is `tools`: it is derived from the grant, so a read-only
connection must not be told it can write.
"""
import json

import pytest

import scopes
import server


@pytest.fixture
def granted(request):
    token = scopes.current_scopes.set(scopes.expand(request.param))
    yield
    scopes.current_scopes.reset(token)


@pytest.mark.parametrize("granted", [[scopes.READ]], indirect=True)
def test_read_only_connection_is_not_told_it_can_write(clean_database, as_user, granted):
    result = json.loads(server.whoami.fn())
    assert result["username"] == "u1"
    assert result["scopes"] == [scopes.READ]
    assert "persona_modify" not in result["tools"]
    assert "get_context" in result["tools"]


@pytest.mark.parametrize("granted", [[scopes.WRITE]], indirect=True)
def test_full_grant_lists_the_write_tools(clean_database, as_user, granted):
    result = json.loads(server.whoami.fn())
    assert set(result["scopes"]) == set(scopes.ALL_SCOPES)
    assert "persona_modify" in result["tools"]


def test_no_grant_on_the_request_authorises_nothing(clean_database, as_user):
    # Fail-closed, matching mcp_scopes: an unset grant is not a full one.
    result = json.loads(server.whoami.fn())
    assert result["scopes"] == []
    assert result["tools"] == []
    assert result["credential"] == "unknown"
