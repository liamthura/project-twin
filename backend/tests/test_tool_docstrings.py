import server


def test_get_context_docstring_steers_to_search():
    doc = server.get_context.fn.__doc__
    assert "search_context" in doc and "get_entity" in doc


def test_full_scope_demoted():
    doc = server.get_context.fn.__doc__
    assert "Complex questions" not in doc


def test_get_raw_docstring_steers():  # locks the earlier steer in place
    assert "search_context" in server.get_raw.fn.__doc__
