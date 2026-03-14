"""
Matches photo metadata to crop recommendations.

Returns the top 2-3 distinct crop options for a photo,
each with calculated coordinates and research evidence.
"""
import yaml
from backend import config

_cached: dict | None = None

CROP_ARTIFACT_PATH = config.LIBRARY_DIR / "production_crop_recommendations.yml"


def _load():
    global _cached
    if _cached is not None:
        return _cached
    if not CROP_ARTIFACT_PATH.exists():
        _cached = {"scenarios": []}
        return _cached
    with open(CROP_ARTIFACT_PATH, "r", encoding="utf-8") as f:
        _cached = yaml.safe_load(f) or {}
    return _cached


def reload():
    global _cached
    _cached = None
    return _load()


def _matches(conditions: dict, metadata: dict) -> int:
    if not conditions:
        return 0
    score = 0
    for key, expected in conditions.items():
        actual = metadata.get(key)
        if actual is None:
            continue
        if isinstance(expected, list):
            if isinstance(actual, int):
                if actual >= expected[0] and actual <= expected[-1]:
                    score += 1
                else:
                    return 0
            elif actual in expected:
                score += 1
            else:
                return 0
        else:
            if actual == expected:
                score += 1
            else:
                return 0
    return score


def _calculate_crop_coords(
    crop_spec: dict,
    img_width: int,
    img_height: int,
) -> dict:
    target_ratio = crop_spec.get("aspect_ratio", 0.8)
    focus = crop_spec.get("focus", "center")

    if img_width == 0 or img_height == 0:
        return {"x": 0, "y": 0, "w": 100, "h": 100}

    current_ratio = img_width / img_height

    if abs(current_ratio - target_ratio) < 0.02:
        return {"x": 0, "y": 0, "w": 100, "h": 100}

    if current_ratio > target_ratio:
        new_w_px = img_height * target_ratio
        w_pct = (new_w_px / img_width) * 100
        h_pct = 100.0

        if focus == "rule_of_thirds":
            x_pct = max(0, min(100 - w_pct, (100 - w_pct) * 0.33))
        else:
            x_pct = (100 - w_pct) / 2
        y_pct = 0.0
    else:
        new_h_px = img_width / target_ratio
        h_pct = (new_h_px / img_height) * 100
        w_pct = 100.0
        x_pct = 0.0

        if focus == "face_upper_third":
            y_pct = max(0, min(100 - h_pct, (100 - h_pct) * 0.15))
        else:
            y_pct = (100 - h_pct) / 2

    x_pct = round(max(0, x_pct), 2)
    y_pct = round(max(0, y_pct), 2)
    w_pct = round(min(100 - x_pct, w_pct), 2)
    h_pct = round(min(100 - y_pct, h_pct), 2)

    return {"x": x_pct, "y": y_pct, "w": w_pct, "h": h_pct}


def _build_option(scenario: dict, img_width: int, img_height: int, rank: int) -> dict:
    crop_spec = scenario.get("crop", {})
    coords = _calculate_crop_coords(crop_spec, img_width, img_height)
    return {
        "rank": rank,
        "scenario_id": scenario.get("id"),
        "scenario_name": scenario.get("name"),
        "aspect_label": crop_spec.get("aspect_label", "4:5"),
        "aspect_ratio": crop_spec.get("aspect_ratio", 0.8),
        "focus": crop_spec.get("focus", "center"),
        "evidence": crop_spec.get("evidence", ""),
        "platform_note": crop_spec.get("platform_note", ""),
        "crop": coords,
    }


def get_crop_options(
    metadata: dict,
    img_width: int = 0,
    img_height: int = 0,
    max_options: int = 3,
) -> list[dict]:
    """
    Return the top 2-3 distinct crop options for a photo.
    Each option has different framing (aspect, focus, padding) so the
    user can click through them and pick the one they prefer.
    """
    data = _load()
    scenarios = data.get("scenarios", [])

    scored = []
    for scenario in scenarios:
        conditions = scenario.get("conditions", {})
        score = _matches(conditions, metadata)
        scored.append((score, scenario))

    scored.sort(key=lambda x: x[0], reverse=True)

    options = []
    seen_coords = set()

    for score, scenario in scored:
        option = _build_option(scenario, img_width, img_height, len(options) + 1)

        coord_key = (
            option["crop"]["x"],
            option["crop"]["y"],
            option["crop"]["w"],
            option["crop"]["h"],
        )
        if coord_key in seen_coords:
            continue
        seen_coords.add(coord_key)

        is_no_op = coord_key == (0, 0, 100, 100)
        if is_no_op and len(options) > 0:
            continue

        options.append(option)
        if len(options) >= max_options:
            break

    if not options:
        fallback = scenarios[-1] if scenarios else None
        if fallback:
            options.append(_build_option(fallback, img_width, img_height, 1))

    return options


def get_crop_recommendation(
    metadata: dict,
    img_width: int = 0,
    img_height: int = 0,
) -> dict | None:
    """Legacy single-result wrapper."""
    options = get_crop_options(metadata, img_width, img_height, max_options=1)
    return options[0] if options else None
