# =============================================================================
# MyGist - Full Stack Docker Image
# =============================================================================
# Serves frontend + API + MCP on one URL
# 
# Build:  docker build -t mygist .
# Run:    docker run -p 8000:8000 -e MYGIST_API_TOKEN=<token> -v ./data:/app/data mygist
# =============================================================================

# --- Stage 1: Build Frontend ---
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build for production
RUN npm run build

# --- Stage 2: Python Backend + Static Files ---
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/main.py .
COPY backend/server.py .
COPY backend/app.py .

# Copy built frontend from stage 1
COPY --from=frontend-builder /build/dist /app/static

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV PERSONA_DATA_DIR=/app/data \
    STATIC_DIR=/app/static

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the combined app
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
