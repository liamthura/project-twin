"""
MyGist Combined App

Single entry point that serves both:
- REST API at /api/* (for frontend)
- MCP server at /mcp/* (for AI clients)

Usage:
    uvicorn app:app --host 0.0.0.0 --port 8000
"""

import os
import secrets
import logging
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG", "false").lower() == "true" else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import both apps
from main import app as rest_app
from server import mcp

# Get MCP's Starlette app
mcp_app = mcp.http_app()


# =============================================================================
# Bearer Auth Middleware (for MCP routes only)
# =============================================================================

class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Bearer token authentication for MCP endpoints."""
    
    def __init__(self, app, token: str = None):
        super().__init__(app)
        self.token = token
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        # Skip auth for health checks and non-MCP routes
        if path in ["/", "/health", "/healthz"] or not path.startswith("/mcp"):
            return await call_next(request)
        
        # If no token configured, allow all (dev mode)
        if not self.token:
            return await call_next(request)
        
        # Check Authorization header
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                {"error": "Missing Bearer token"},
                status_code=401
            )
        
        provided_token = auth_header[7:]  # Remove "Bearer " prefix
        if not secrets.compare_digest(provided_token, self.token):
            return JSONResponse(
                {"error": "Invalid token"},
                status_code=403
            )
        
        return await call_next(request)


# =============================================================================
# Root & Health endpoints
# =============================================================================

async def root_handler(request):
    """Root endpoint with service info."""
    return JSONResponse({
        "service": "MyGist",
        "version": "2.0.0",
        "description": "Your portable personal context for AI",
        "endpoints": {
            "api": "/api/* (REST for frontend)",
            "mcp": "/mcp/* (MCP for AI clients)",
            "health": "/health"
        }
    })


async def health_handler(request):
    """Health check endpoint."""
    from server import DATA_DIR
    return JSONResponse({
        "status": "ok",
        "service": "mygist",
        "data_dir": str(DATA_DIR),
        "data_dir_exists": DATA_DIR.exists()
    })


# =============================================================================
# Combined App
# =============================================================================

# Create the combined Starlette app
app = Starlette(
    routes=[
        Route("/", endpoint=root_handler, methods=["GET"]),
        Route("/health", endpoint=health_handler, methods=["GET"]),
        Route("/healthz", endpoint=health_handler, methods=["GET"]),
        Mount("/api", app=rest_app),  # REST API
        Mount("/mcp", app=mcp_app),   # MCP server
    ]
)

# Add Bearer auth middleware
api_token = os.getenv("MYGIST_API_TOKEN")
app.add_middleware(BearerAuthMiddleware, token=api_token)

# Add CORS for frontend
from starlette.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("MyGist combined app initialized")
logger.info(f"Auth enabled: {bool(api_token)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
