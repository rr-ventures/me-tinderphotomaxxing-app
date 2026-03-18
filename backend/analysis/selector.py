"""
Style selector — the decision brain.

Takes photo metadata and picks the best 2 styles from the YAML library.
Rules are checked top-to-bottom. First match wins.
If nothing matches, the fallback is always true_to_life_clean.
"""
from backend.analysis.library_loader import (
    get_routing_rules,
    get_secondary_pairing,
    get_style_plans,
)
from backend.analysis.metadata import PhotoMetadata, StyleResult

FALLBACK_STYLE = "true_to_life_clean"


def _count_conditions(rule: dict) -> int:
    """Return the number of explicit conditions in a rule (higher = more specific)."""
    conditions = rule.get("if")
    if conditions == "default" or not isinstance(conditions, dict):
        return 0
    return len(conditions)


def _matches_rule(metadata: PhotoMetadata, rule: dict) -> bool:
    """Check if a photo's metadata matches a routing rule from the YAML library."""
    conditions = rule.get("if")

    if conditions == "default":
        return True

    if not isinstance(conditions, dict):
        return False

    for field, expected in conditions.items():
        if field == "photo_quality_min":
            if metadata.photo_quality < expected:
                return False
            continue

        actual = getattr(metadata, field, None)
        if actual is None:
            return False

        if isinstance(expected, list):
            if actual not in expected:
                return False
        else:
            if actual != expected:
                return False

    return True


def select_styles(metadata: PhotoMetadata) -> StyleResult:
    """
    Run the routing logic against photo metadata.

    All matching rules are collected, then the most specific one (most conditions)
    wins. Among equally specific matches, the one that appears earliest in the YAML
    is preferred. Fallback is always true_to_life_clean.
    """
    rules = get_routing_rules()
    pairings = get_secondary_pairing()
    primary = FALLBACK_STYLE
    reason = "Default fallback — no specific style matched strongly"

    matching_rules = [
        (rule, _count_conditions(rule))
        for rule in rules
        if _matches_rule(metadata, rule)
    ]

    if matching_rules:
        # Pick the most specific match (most conditions); ties break by YAML order (index 0)
        best_rule, _ = max(matching_rules, key=lambda x: x[1])
        primary = best_rule.get("choose", FALLBACK_STYLE)
        reason = best_rule.get("rule", "Matched routing rule")

    secondary = pairings.get(primary, FALLBACK_STYLE)

    primary_plans = get_style_plans(primary) or {}
    secondary_plans = get_style_plans(secondary) or {}

    return StyleResult(
        primary_style=primary,
        secondary_style=secondary,
        selection_reason=reason,
        primary_plans=primary_plans,
        secondary_plans=secondary_plans,
    )


def select_styles_from_dict(metadata_dict: dict) -> dict:
    """
    Convenience function: takes a raw metadata dict, returns a result dict.
    Used by the API routes.
    """
    metadata = PhotoMetadata.from_dict(metadata_dict)
    result = select_styles(metadata)
    return {
        **result.to_dict(),
        "metadata": metadata.to_dict(),
    }
