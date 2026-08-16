"""A refused client registration, made actionable.

Better Auth's refusal is correct and its message is not usable: it states the
rule, names neither the offending URI nor a fix, and arrives at the one moment
someone is stuck. These tests pin the two properties that matter -- it explains
the case it should, and it touches nothing else.
"""
import json

import httpx
import pytest

import auth_proxy


def _upstream(payload, status=400):
    return httpx.Response(
        status, content=json.dumps(payload).encode(), headers={"content-type": "application/json"}
    )


REFUSAL = {
    "message": "[body.redirect_uris.0] Redirect URI must use HTTPS (HTTP allowed only for loopback hosts)",
    "code": "VALIDATION_ERROR",
}


def _body(*uris):
    return json.dumps({"client_name": "x", "redirect_uris": list(uris)}).encode()


class TestItExplains:
    def test_it_names_the_uri_that_broke_the_rule(self):
        out = auth_proxy.explain_registration_refusal(
            _body("http://thuradev-main:9119/api/mcp/oauth/callback/mygist"), _upstream(REFUSAL)
        )
        payload = json.loads(out.body)
        assert payload["rejected_redirect_uris"] == [
            "http://thuradev-main:9119/api/mcp/oauth/callback/mygist"
        ]
        assert "thuradev-main:9119" in payload["message"]

    def test_it_keeps_the_upstream_code_and_sentence(self):
        """A client may already match on either, so both are appended to."""
        out = auth_proxy.explain_registration_refusal(_body("http://box:9119/cb"), _upstream(REFUSAL))
        payload = json.loads(out.body)
        assert payload["code"] == "VALIDATION_ERROR"
        assert payload["message"].startswith(REFUSAL["message"])
        assert out.status_code == 400

    def test_it_names_the_fixes_that_actually_apply(self):
        out = auth_proxy.explain_registration_refusal(_body("http://box:9119/cb"), _upstream(REFUSAL))
        message = json.loads(out.body)["message"]
        assert "127.0.0.1" in message
        # The real topology behind this: a dashboard reached over a tunnel.
        assert "tunnel" in message and "tailscale serve" in message

    def test_the_docs_link_is_relative_to_this_instance(self):
        """An absolute URL would send self-hosters' users to someone else's box."""
        out = auth_proxy.explain_registration_refusal(_body("http://box:9119/cb"), _upstream(REFUSAL))
        assert json.loads(out.body)["docs"].startswith("/docs/")

    def test_an_unparseable_body_still_explains_the_rule(self):
        """The guidance is the point; the named URI is a bonus."""
        out = auth_proxy.explain_registration_refusal(b"not json", _upstream(REFUSAL))
        payload = json.loads(out.body)
        assert payload["rejected_redirect_uris"] == []
        assert "127.0.0.1" in payload["message"]


class TestItTouchesNothingElse:
    def test_a_successful_registration_is_untouched(self):
        assert auth_proxy.explain_registration_refusal(
            _body("https://ok/cb"), _upstream({"client_id": "x"}, status=200)
        ) is None

    def test_a_different_400_is_untouched(self):
        assert auth_proxy.explain_registration_refusal(
            _body("https://ok/cb"),
            _upstream({"message": "invalid_scope: offline_access", "code": "VALIDATION_ERROR"}),
        ) is None

    def test_a_non_json_400_is_untouched(self):
        assert auth_proxy.explain_registration_refusal(
            _body("https://ok/cb"), httpx.Response(400, content=b"<html>gateway</html>")
        ) is None


class TestWhichHostsCount:
    @pytest.mark.parametrize("uri", [
        "http://127.0.0.1:9876/cb",
        "http://127.1.2.3:9876/cb",
        "http://localhost:9876/cb",
        "http://tenant.localhost:9876/cb",
        "http://[::1]:9876/cb",
        "https://anything.example.com/cb",
        "hermes://oauth/callback",
    ])
    def test_accepted_shapes_are_never_named_as_the_problem(self, uri):
        assert auth_proxy._rejected_redirect_uris(_body(uri)) == []

    @pytest.mark.parametrize("uri", [
        "http://thuradev-main:9119/cb",      # the tunnelled dashboard, the real case
        "http://192.168.1.50:9876/cb",
        "http://0.0.0.0:9876/cb",            # unspecified, not loopback
        "http://app.example.com/cb",
    ])
    def test_refused_shapes_are_named(self, uri):
        assert auth_proxy._rejected_redirect_uris(_body(uri)) == [uri]

    def test_only_the_offending_entry_is_named(self):
        rejected = auth_proxy._rejected_redirect_uris(
            _body("https://fine/cb", "http://box:9119/cb", "http://127.0.0.1:1/cb")
        )
        assert rejected == ["http://box:9119/cb"]
