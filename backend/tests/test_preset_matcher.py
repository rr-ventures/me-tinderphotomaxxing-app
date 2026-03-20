"""Preset matcher: metadata → Lightroom scenario recommendations."""
import pytest

from backend.analysis.preset_matcher import get_recommendations, reload


@pytest.fixture(autouse=True)
def _reload_yaml():
    reload()


def test_indoor_mixed_well_lit_beats_group_low_light_pop():
    """Sauna-style indoor + mixed light + medium quality should not map to dark group Pop."""
    meta = {
        "scene_type": "indoor",
        "lighting": "mixed",
        "face_visible": "yes",
        "photo_quality": 6,
        "color_quality": "good",
        "expression": "neutral",
    }
    recs = get_recommendations(meta, max_results=3)
    assert recs, "expected at least one recommendation"
    top = recs[0]
    assert top.get("id") == "indoor_mixed", f"expected indoor_mixed first, got {top.get('id')}"
    assert "Polished Portrait" in (top.get("preset") or {}).get("name", "")


def test_group_low_light_still_matches_dark_mixed():
    meta = {
        "scene_type": "indoor",
        "lighting": "mixed",
        "face_visible": "yes",
        "photo_quality": 4,
        "color_quality": "flat",
    }
    recs = get_recommendations(meta, max_results=5)
    ids = [r.get("id") for r in recs]
    assert "group_social_low_light" in ids
