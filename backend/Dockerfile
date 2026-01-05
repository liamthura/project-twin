# =============================================================================
# MyGist MCP Server - Docker Image
# =============================================================================
# Build:  docker build -t mygist-mcp .
# Run:    docker run -p 8000:8000 -e MYGIST_API_TOKEN=<token> -v ./data:/app/data mygist-mcp
# =============================================================================

FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0 \
    MCP_TRANSPORT=http

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .
COPY server.py .
COPY app.py .

# Create data directory (will be mounted as volume in production)
RUN mkdir -p /app/data

# Set data directory environment variable
ENV PERSONA_DATA_DIR=/app/data

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the combined app
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
