"""
MyGist Combined App

Single entry point that serves:
- Frontend UI at / (static files)
- REST API at /api/* (for frontend)
- MCP server at /mcp/* (for AI clients)

Usage:
    uvicorn app:app --host 0.0.0.0 --port 8000
"""

import os
import secrets
import logging
from pathlib import Path
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, FileResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
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
# main.py is FastAPI (which is also ASGI-compatible)
from main import app as fastapi_app
from server import mcp, DATA_DIR

# Get MCP's Starlette app
mcp_app = mcp.http_app()

# Frontend static files directory
STATIC_DIR = Path(os.getenv("STATIC_DIR", Path(__file__).parent / "static"))


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
        
        # Skip auth for health checks, static files, and API routes
        # Only require auth for /mcp/* routes
        if not path.startswith("/mcp"):
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
# Health endpoint
# =============================================================================

async def health_handler(request):
    """Health check endpoint."""
    return JSONResponse({
        "status": "ok",
        "service": "mygist",
        "data_dir": str(DATA_DIR),
        "data_dir_exists": DATA_DIR.exists()
    })


# =============================================================================
# SPA Fallback - serve index.html for client-side routing
# =============================================================================

async def spa_fallback(request):
    """Serve index.html for SPA client-side routing."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({
        "error": "Frontend not built. Run 'npm run build' in frontend directory.",
        "api": "/api/*",
        "mcp": "/mcp/*"
    }, status_code=404)


# =============================================================================
# Combined App
# =============================================================================

def create_combined_app():
    """Create the combined app with all routes."""
    
    # Build routes list - order matters!
    routes = [
        Route("/health", endpoint=health_handler, methods=["GET"]),
        Route("/healthz", endpoint=health_handler, methods=["GET"]),
        Mount("/mcp", app=mcp_app),        # MCP server at /mcp/*
    ]
    
    # Add static file serving if frontend is built
    if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
        # Static assets (vite puts JS/CSS here)
        if (STATIC_DIR / "assets").exists():
            routes.append(Mount("/assets", app=StaticFiles(directory=STATIC_DIR / "assets")))
        logger.info(f"Serving frontend from: {STATIC_DIR}")
    else:
        logger.warning(f"Frontend not found at: {STATIC_DIR}")
    
    # Mount FastAPI app - handles /api/* and / routes
    # This must come after specific routes but will handle everything else
    routes.append(Mount("/", app=fastapi_app))
    
    app = Starlette(routes=routes)
    
    # Add Bearer auth middleware
    api_token = os.getenv("MYGIST_API_TOKEN")
    app.add_middleware(BearerAuthMiddleware, token=api_token)
    
    # Add CORS
    from starlette.middleware.cors import CORSMiddleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    logger.info("MyGist combined app initialized")
    logger.info(f"Auth enabled for /mcp: {bool(api_token)}")
    
    return app


# Create app for uvicorn
app = create_combined_app()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
