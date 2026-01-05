# MyGist API Server
# Build:  docker build -t mygist-api .
# Run:    docker run -p 8000:8000 -e MYGIST_API_TOKEN=<token> -v ./data:/app/data mygist-api

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py server.py ./

RUN mkdir -p /app/data
ENV PERSONA_DATA_DIR=/app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
