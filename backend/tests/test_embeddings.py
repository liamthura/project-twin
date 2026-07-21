import httpx
import pytest

import embeddings


def _mock_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_unconfigured_returns_none():
    assert embeddings._build_provider({}, client=None) is None
    assert embeddings._build_provider({"EMBEDDING_PROVIDER": "voyage"}, client=None) is None
    # openai provider needs a URL; key alone is not enough
    assert embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "openai", "EMBEDDING_API_KEY": "k"}, client=None
    ) is None


def test_voyage_request_shape_and_parse():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        import json
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [
            {"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]})

    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk",
         "EMBEDDING_MODEL": "voyage-3.5-lite"},
        client=_mock_client(handler),
    )
    out = p.embed(["a", "b"], input_type="query")
    assert out == [[0.1, 0.2], [0.3, 0.4]]
    assert seen["url"] == "https://api.voyageai.com/v1/embeddings"
    assert seen["auth"] == "Bearer vk"
    assert seen["body"]["model"] == "voyage-3.5-lite"
    assert seen["body"]["input"] == ["a", "b"]
    assert seen["body"]["input_type"] == "query"


def test_openai_compatible_local_no_key():
    def handler(request):
        assert "authorization" not in request.headers
        assert str(request.url) == "http://localhost:11434/v1/embeddings"
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}]})

    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "openai",
         "EMBEDDING_API_URL": "http://localhost:11434/v1",
         "EMBEDDING_MODEL": "nomic-embed-text"},
        client=_mock_client(handler),
    )
    assert p.embed(["x"], input_type="document") == [[1.0]]


def test_http_error_raises_embedding_error():
    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk"},
        client=_mock_client(lambda r: httpx.Response(500, text="boom")),
    )
    with pytest.raises(embeddings.EmbeddingError):
        p.embed(["a"], input_type="document")


def test_get_provider_reads_environ(monkeypatch):
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_API_URL", raising=False)
    assert embeddings.get_provider() is None


def test_default_client_is_shared_not_created_per_call():
    """No explicit client passed -> the provider must reuse the module-level
    shared httpx.Client instead of opening a fresh one per call (leak)."""
    p1 = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk"})
    p2 = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk"})
    assert p1._client is embeddings._CLIENT
    assert p2._client is embeddings._CLIENT


def test_empty_model_env_falls_back_to_default():
    def handler(request):
        import json
        assert json.loads(request.content)["model"] == embeddings.DEFAULT_MODEL
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}]})

    # Compose injects EMBEDDING_MODEL="" for unset vars; must not send model:""
    p = embeddings._build_provider(
        {"EMBEDDING_PROVIDER": "voyage", "VOYAGE_API_KEY": "vk",
         "EMBEDDING_MODEL": ""},
        client=_mock_client(handler),
    )
    assert p.embed(["x"], input_type="document") == [[1.0]]
