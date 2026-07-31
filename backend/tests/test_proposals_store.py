"""Dedupe, tombstones, and the rolling note window."""
import proposals_store as ps


def _note(text, client="Cursor"):
    return ps.create(
        "note", client=client, rationale="durable", evidence="they said so",
        note=text, section_hint="preferences",
    )


def _entity(name, client="Claude Desktop"):
    return ps.create(
        "entity", client=client, rationale="durable", evidence="they said so",
        action="update", entity="domain", identifier=name,
        data={"name": name, "level": "advanced"},
    )


def test_a_new_proposal_is_stored(clean_database, as_user):
    assert _entity("Datadog")["result"] == "stored"


def test_the_same_claim_twice_bumps_seen_count(clean_database, as_user):
    _entity("Datadog")
    assert _entity("Datadog", client="Codex")["result"] == "duplicate_pending"
    [row] = ps.list_pending("entity")
    assert row["seen_count"] == 2


def test_fingerprint_ignores_case_and_spacing(clean_database, as_user):
    _note("Wants  the  recommendation FIRST.")
    assert _note("wants the recommendation first.")["result"] == "duplicate_pending"


def test_a_rejected_claim_is_never_raised_again(clean_database, as_user):
    pid = _entity("Datadog")["id"]
    ps.resolve(pid, "rejected")
    assert _entity("Datadog")["result"] == "previously_rejected"


def test_a_promoted_claim_is_never_raised_again(clean_database, as_user):
    pid = _note("Prefers recommendation first")["id"]
    ps.resolve(pid, "promoted", promoted_to="domain_abc")
    assert _note("Prefers recommendation first")["result"] == "previously_rejected"


def test_an_approved_claim_may_be_raised_again(clean_database, as_user):
    # Approved entity proposals leave the tombstone set: the entity now exists,
    # so a later change to it is a legitimate new proposal.
    pid = _entity("Datadog")["id"]
    ps.resolve(pid, "approved")
    assert _entity("Datadog")["result"] == "stored"


def test_listing_marks_rows_as_seen(clean_database, as_user):
    _note("something")
    assert ps.list_pending("note")[0]["seen_at"] is None
    assert ps.list_pending("note")[0]["seen_at"] is not None


def test_seen_notes_are_trimmed_to_the_window(clean_database, as_user):
    for i in range(ps.NOTE_WINDOW + 10):
        _note(f"observation number {i}")
        ps.list_pending("note")  # each row is seen before the next arrives
    assert len(ps.list_pending("note")) == ps.NOTE_WINDOW


def test_unseen_notes_accumulate_past_the_window(clean_database, as_user):
    # The window is soft for rows the user has not looked at. Trimming here
    # would delete observations they never had the chance to resolve, which is
    # the failure mode the backstop exists to bound rather than cause.
    for i in range(ps.NOTE_WINDOW + 10):
        _note(f"observation number {i}")
    assert len(ps.list_pending("note")) == ps.NOTE_WINDOW + 10


def test_the_backstop_bounds_even_unseen_notes(clean_database, as_user):
    # A runaway client must not grow the table without bound. Crossing the
    # backstop trims back to the window, so the count oscillates between the
    # two rather than pinning at either -- bounded is the property that
    # matters, not any particular value.
    for i in range(ps.NOTE_BACKSTOP * 3):
        _note(f"observation number {i}")
        assert len(ps.list_pending("note", mark_seen=False)) <= ps.NOTE_BACKSTOP


def test_unseen_notes_survive_eviction(clean_database, as_user):
    # The oldest row is seen; the rest are not. Eviction must take the seen one
    # even though newer rows exist, because silently dropping something the
    # user never had a chance to look at is the failure mode that matters.
    _note("the seen one")
    ps.list_pending("note")
    for i in range(ps.NOTE_WINDOW):
        _note(f"unseen {i}")
    texts = {r["note"] for r in ps.list_pending("note")}
    assert "the seen one" not in texts


def test_eviction_prefers_the_least_corroborated(clean_database, as_user):
    _note("raised once")
    _note("raised twice")
    _note("raised twice", client="Codex")  # seen_count -> 2
    ps.list_pending("note")  # mark both seen so seen_at is not the tiebreaker
    for i in range(ps.NOTE_WINDOW):
        _note(f"filler {i}")
        ps.list_pending("note")
    texts = {r["note"] for r in ps.list_pending("note")}
    assert "raised twice" in texts
    assert "raised once" not in texts


def test_entity_proposals_are_not_evicted(clean_database, as_user):
    for i in range(ps.NOTE_WINDOW + 10):
        _entity(f"Tool{i}")
    assert len(ps.list_pending("entity")) == ps.NOTE_WINDOW + 10


def test_proposals_are_scoped_to_their_user(clean_database, as_user):
    import db
    _note("mine")
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "insert into users (username, token_hash) values ('u2', 'y') returning id"
        ).fetchone()
    token = db.current_user_id.set(str(row["id"]))
    try:
        assert ps.list_pending("note") == []
    finally:
        db.current_user_id.reset(token)
