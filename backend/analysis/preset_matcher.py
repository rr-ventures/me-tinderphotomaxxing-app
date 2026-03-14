"""
Matches photo metadata to Lightroom preset recommendations.

Loads the preset recommendations artifact and finds the best
matching scenario for a given set of photo metadata.
"""
import yaml
from backend import config

_cached: dict | None = None


def _load():
    global _cached
    if _cached is not None:
        return _cached
    path = config.PRESET_RECOMMENDATIONS_PATH
    if not path.exists():
        _cached = {"scenarios": [], "danger_zones": []}
        return _cached
    with open(path, "r", encoding="utf-8") as f:
        _cached = yaml.safe_load(f) or {}
    return _cached


def reload():
    global _cached
    _cached = None
    return _load()


def _matches(conditions: dict, metadata: dict) -> tuple[int, int]:
    """
    Return (match_score, penalty).
    match_score = number of conditions satisfied.
    penalty = number of conditions that actively contradicted the metadata.
    A scenario with 0 penalties is 'compatible' even if score is 0 (metadata was sparse).
    """
    if not conditions:
        return (0, 0)
    score = 0
    penalty = 0
    for key, expected in conditions.items():
        actual = metadata.get(key)
        if actual is None:
            continue
        if isinstance(expected, list):
            if isinstance(actual, int):
                if actual >= expected[0] and actual <= expected[-1]:
                    score += 1
                else:
                    penalty += 1
            elif actual in expected:
                score += 1
            else:
                penalty += 1
        else:
            if actual == expected:
                score += 1
            else:
                penalty += 1
    return (score, penalty)


def get_recommendation(metadata: dict) -> dict | None:
    """Legacy single-result wrapper."""
    results = get_recommendations(metadata, max_results=1)
    return results[0] if results else None


def get_recommendations(metadata: dict, max_results: int = 3) -> list[dict]:
    """
    Return the top N distinct preset recommendations for a photo.
    Deduplicates by preset name so the user sees genuinely different options.

    Scoring: scenarios are sorted by (match_score DESC, penalty ASC) so that
    strong matches come first, and compatible-but-unconfirmed scenarios fill
    remaining slots (rather than returning only 1 result).
    """
    data = _load()
    scenarios = data.get("scenarios", [])

    scored = []
    for scenario in scenarios:
        conditions = scenario.get("conditions", {})
        match_score, penalty = _matches(conditions, metadata)
        scored.append((match_score, penalty, scenario))

    scored.sort(key=lambda x: (-x[0], x[1]))

    results = []
    seen_presets = set()

    for match_score, penalty, scenario in scored:
        if penalty > 0:
            continue
        preset_name = scenario.get("preset", {}).get("name", "")
        if preset_name in seen_presets:
            continue
        seen_presets.add(preset_name)
        results.append(scenario)
        if len(results) >= max_results:
            break

    if not results:
        fallback = next(
            (s for s in scenarios if s.get("id") == "outdoor_overcast"),
            scenarios[0] if scenarios else None,
        )
        if fallback:
            results.append(fallback)

    return results


def get_danger_zones() -> list:
    data = _load()
    return data.get("danger_zones", [])
