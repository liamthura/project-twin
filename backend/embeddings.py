"""Embedding providers for the search index (spec: search-retrieval design).

Two providers behind one interface:
  - voyage: hosted Voyage AI (VOYAGE_API_KEY)
  - openai: any OpenAI-compatible /v1/embeddings endpoint — Ollama, LM Studio,
    llama.cpp server, vLLM, LocalAI, or OpenAI itself (EMBEDDING_API_URL,
    EMBEDDING_API_KEY optional for local servers)

get_provider() returns None when unconfigured; callers treat None as
FTS-only mode. embed() raises EmbeddingError on any transport/parse problem;
callers catch it and degrade (never propagate to a persona write).
"""

import os

import httpx

TIMEOUT_SECONDS = 8.0  # document batches (background thread)
QUERY_TIMEOUT_SECONDS = 2.0  # per-search query embedding (user-facing path)
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
DEFAULT_MODEL = "voyage-3.5-lite"


class EmbeddingError(Exception):
    pass


# Shared across all providers built without an explicit `client` (i.e. every
# real call site -- get_provider() never passes one). A fresh httpx.Client
# per call/provider would leak a connection pool on every request; get_provider()
# stays env-dynamic (rebuilds the provider each call) but must not rebuild
# the transport too.
_CLIENT = httpx.Client()


class _HttpProvider:
    def __init__(self, url, model, api_key, send_input_type, client):
        self._url = url
        self._model = model
        self._api_key = api_key
        self._send_input_type = send_input_type  # Voyage extension; OpenAI-compat servers reject unknown fields
        self._client = client or _CLIENT

    def embed(self, texts, input_type="document"):
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = {"model": self._model, "input": texts}
        if self._send_input_type:
            body["input_type"] = input_type
        timeout = QUERY_TIMEOUT_SECONDS if input_type == "query" else TIMEOUT_SECONDS
        try:
            resp = self._client.post(self._url, json=body, headers=headers, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()["data"]
            return [item["embedding"] for item in data]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise EmbeddingError(str(exc)) from exc


def _build_provider(env, client=None):
    provider = env.get("EMBEDDING_PROVIDER", "voyage")
    model = env.get("EMBEDDING_MODEL", DEFAULT_MODEL)
    if provider == "voyage":
        key = env.get("VOYAGE_API_KEY")
        if not key:
            return None
        return _HttpProvider(VOYAGE_URL, model, key, send_input_type=True, client=client)
    if provider == "openai":
        base = env.get("EMBEDDING_API_URL")
        if not base:
            return None
        url = base.rstrip("/") + "/embeddings"
        return _HttpProvider(url, model, env.get("EMBEDDING_API_KEY"), send_input_type=False, client=client)
    return None


def get_provider():
    return _build_provider(os.environ)
