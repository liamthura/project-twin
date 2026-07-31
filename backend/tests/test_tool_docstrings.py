import server


def test_get_context_docstring_steers_to_search():
    doc = server.get_context.fn.__doc__
    assert "search_context" in doc and "get_entity" in doc


def test_full_scope_demoted():
    doc = server.get_context.fn.__doc__
    assert "Complex questions" not in doc


def test_get_raw_docstring_steers():  # locks the earlier steer in place
    assert "search_context" in server.get_raw.fn.__doc__


# ---------------------------------------------------------------------------
# The write path has two doors and only one of them is obvious.
#
# An agent that infers something durable reaches for the tool it already knows
# -- persona_modify -- and writes immediately, which is the exact behaviour the
# proposal queue exists to prevent. Stating the rule only inside
# propose_update's own docstring is no use: that is read after the agent has
# already decided to propose. The steer has to live where the wrong turn is
# taken.
# ---------------------------------------------------------------------------


def test_persona_modify_names_the_proposal_path():
    doc = server.persona_modify.fn.__doc__
    assert "propose_update" in doc


def test_persona_modify_says_when_it_is_the_wrong_tool():
    doc = server.persona_modify.fn.__doc__.lower()
    assert "explicit" in doc or "asked" in doc


def test_persona_batch_names_the_proposal_path():
    assert "propose_update" in server.persona_batch.fn.__doc__


def test_get_schema_names_the_proposal_path(clean_database, as_user):
    # get_schema publishes the entity vocabulary, and proposals are written in
    # exactly that vocabulary -- so an agent learning the schema in order to
    # write must be told both ways of doing it.
    assert "propose_update" in server.get_schema.fn(entity="domain")


def test_the_schema_overview_names_the_proposal_path(clean_database, as_user):
    # The no-argument call is the one an agent makes to orient itself.
    assert "propose_update" in server.get_schema.fn()


def test_propose_update_still_names_the_direct_path():
    assert "persona_modify" in server.propose_update.fn.__doc__
