"""OAuth discovery documents.

An MCP client's first move against a protected server is to be refused, read the
WWW-Authenticate header, and follow it to a metadata document. Everything else
depends on these four URLs resolving, and when they do not the symptom is a
client that simply says it cannot connect.

Two of them are ours to write; two belong to the auth service and are forwarded.
The forwarded pair exist because Better Auth is mounted at /auth, so its issuer
is https://host/auth -- and RFC 8414 tells clients to look for the metadata at
the ROOT with the issuer's path appended, i.e. /.well-known/oauth-authorization-
server/auth, which the /auth/{path} proxy cannot reach.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

import auth_proxy
import jwt_auth
import scopes

logger = logging.getLogger(__name__)

# Where the auth service serves its own metadata, under its base path.
_UPSTREAM_AS_METADATA = "/auth/.well-known/oauth-authorization-server"


def protected_resource_metadata() -> dict:
    """RFC 9728. Names this resource and the server that can authorise it.

    scopes_supported lists all three persona scopes. offline_access is
    deliberately absent: "MCP Servers SHOULD NOT include offline_access in
    WWW-Authenticate scope or Protected Resource Metadata scopes_supported, as
    refresh tokens are not a resource requirement." Clients ask for it directly.
    """
    return {
        "resource": jwt_auth.MCP_RESOURCE,
        "authorization_servers": [jwt_auth.ISSUER],
        "scopes_supported": list(scopes.ALL_SCOPES),
        "bearer_methods_supported": ["header"],
    }


def register(app: FastAPI) -> bool:
    """Mount the discovery routes. Returns whether they were.

    MUST be called before the MCP app is mounted at "/": FastAPI matches routes
    in registration order, and that mount matches everything. This is the same
    trap that once made a bare /docs 404, and here it would make every one of
    these documents unreachable while /health kept saying ok.
    """
    # The same predicate the middleware uses to decide whether to send a
    # WWW-Authenticate challenge, and it has to be: MCP_RESOURCE alone is not
    # enough to verify a single token -- without AUTH_JWKS_URL there is no key
    # to check a signature against, so verify_access_token refuses everything.
    # Mounting these documents on a half-configured instance advertises a route
    # that leads a client through discovery, registration and consent to a /mcp
    # that will reject the token it just earned.
    if not jwt_auth.mcp_resource_configured():
        return False

    @app.get("/.well-known/oauth-protected-resource", include_in_schema=False)
    @app.get("/.well-known/oauth-protected-resource/mcp", include_in_schema=False)
    async def protected_resource() -> Response:
        # Both paths serve the same document. The path-inserted form is what a
        # client derives from the resource URI; the bare one is where clients
        # that fail to parse WWW-Authenticate fall back.
        return JSONResponse(protected_resource_metadata())

    @app.api_route(
        "/.well-known/oauth-authorization-server",
        methods=["GET", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    @app.api_route(
        "/.well-known/oauth-authorization-server/auth",
        methods=["GET", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    async def authorization_server(request: Request) -> Response:
        return await auth_proxy.forward(_UPSTREAM_AS_METADATA, request)

    return True
