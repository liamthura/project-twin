import persona_store as store
import settings_store as ss


def test_get_settings_empty_by_default(as_user):
    assert ss.get_settings() == {}


def test_set_and_get_settings_roundtrip(as_user):
    ss.set_settings({"disabled_sections": ["circle"], "future": {"x": 1}})
    assert ss.get_settings() == {"disabled_sections": ["circle"], "future": {"x": 1}}


def test_disabled_sections_helpers(as_user):
    assert ss.get_disabled_sections() == set()
    ss.set_disabled_sections(["knowledge", "circle"])
    assert ss.get_disabled_sections() == {"knowledge", "circle"}


def test_set_disabled_preserves_other_settings_keys(as_user):
    ss.set_settings({"future": {"x": 1}})
    ss.set_disabled_sections(["lifestyle"])
    blob = ss.get_settings()
    assert blob["future"] == {"x": 1}
    assert set(blob["disabled_sections"]) == {"lifestyle"}


def test_settings_blob_is_invisible_to_persona_get_all(as_user):
    ss.set_disabled_sections(["circle"])
    # get_all iterates the registry (VALID_FILES); _settings must not appear.
    assert ss.SETTINGS_KEY not in store.get_all()


def test_enabled_sections_all_by_default(as_user):
    import sections
    # media/aesthetics are default-off (opt-in); every other pack is on.
    assert ss.enabled_sections() == set(sections.SECTION_REGISTRY) - {"media", "aesthetics"}


def test_enabled_sections_drops_disabled(as_user):
    ss.set_disabled_sections(["circle"])
    assert "circle" not in ss.enabled_sections()
    assert "knowledge" in ss.enabled_sections()


def test_enabled_sections_force_includes_always_on(as_user):
    import sections
    # a hand-crafted blob disabling a core section must have no effect
    ss.set_disabled_sections(["profile", "circle"])
    enabled = ss.enabled_sections()
    assert sections.ALWAYS_ON_SECTIONS <= enabled
    assert "circle" not in enabled


def test_onboarding_defaults_for_an_account_that_predates_it(as_user):
    assert ss.get_onboarding() == {"dismissed": False, "steps": {}}


def test_onboarding_round_trips(as_user):
    ss.set_onboarding({"dismissed": True, "steps": {"about-you": "done"}})
    assert ss.get_onboarding() == {
        "dismissed": True,
        "steps": {"about-you": "done"},
    }


def test_onboarding_does_not_disturb_the_rest_of_the_blob(as_user):
    ss.set_disabled_sections(["circle"])
    ss.set_onboarding({"dismissed": True, "steps": {}})
    assert ss.get_disabled_sections() == {"circle"}


def test_onboarding_repairs_a_blob_written_by_hand(as_user):
    # The settings blob is free-form on the Python side and nothing stops a
    # future writer -- or a hand-edited row -- leaving a string here. Reading it
    # must produce a usable shape rather than raising in a GET everything else
    # depends on.
    blob = ss.get_settings()
    blob["onboarding"] = "yes"
    ss.set_settings(blob)
    assert ss.get_onboarding() == {"dismissed": False, "steps": {}}


def test_onboarding_drops_steps_and_statuses_it_does_not_recognise(as_user):
    # `welcome` collects nothing, so a status on it would record a page view.
    ss.set_onboarding(
        {"dismissed": False, "steps": {"welcome": "done", "about-you": "later"}}
    )
    assert ss.get_onboarding() == {"dismissed": False, "steps": {}}
