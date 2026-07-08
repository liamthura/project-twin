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
