"""
Filter Research Report — Profile Photo Optimization.
Market research on the best Instagram/social-media filters and color grading
techniques for profile photos, organized by scene type and lighting conditions.

Each filter entry includes:
  - name: Consumer-facing filter name
  - id: Machine-readable identifier
  - category: Broad grouping
  - best_for: List of scene types / conditions where this filter excels
  - description: What the filter does visually
  - color_profile: Dominant color shifts
  - mood: Emotional tone the filter conveys
  - intensity: Recommended application strength (subtle / moderate / strong)
"""

FILTER_CATALOG = [
    {
        "name": "Golden Hour",
        "id": "golden_hour",
        "category": "warm",
        "best_for": ["outdoor daylight", "sunset", "golden light", "parks", "gardens", "beach"],
        "description": "Adds warm amber tones that mimic late-afternoon sunlight. Softens shadows and lifts midtones for a sun-kissed glow.",
        "color_profile": {"highlights": "warm gold", "shadows": "soft orange", "midtones": "amber"},
        "mood": "warm, inviting, optimistic",
        "intensity": "moderate",
    },
    {
        "name": "Clean Portrait",
        "id": "clean_portrait",
        "category": "neutral",
        "best_for": ["studio lighting", "headshot", "indoor neutral", "professional", "corporate"],
        "description": "Subtle skin-tone enhancement with neutral white balance. Adds gentle contrast and micro-sharpening for a polished, professional look.",
        "color_profile": {"highlights": "neutral white", "shadows": "soft grey", "midtones": "true-to-life"},
        "mood": "professional, clean, trustworthy",
        "intensity": "subtle",
    },
    {
        "name": "Moody Blue",
        "id": "moody_blue",
        "category": "cool",
        "best_for": ["overcast", "urban night", "city skyline", "rainy", "moody", "evening"],
        "description": "Cool blue-teal color grade with lifted blacks and desaturated reds. Creates a cinematic, editorial feel.",
        "color_profile": {"highlights": "cool blue", "shadows": "deep teal", "midtones": "desaturated"},
        "mood": "cinematic, mysterious, sophisticated",
        "intensity": "moderate",
    },
    {
        "name": "Vibrant Pop",
        "id": "vibrant_pop",
        "category": "vivid",
        "best_for": ["colorful backgrounds", "tropical", "pool", "resort", "festival", "flowers", "graffiti"],
        "description": "Boosts saturation and vibrancy across all channels. Adds punch to colors while keeping skin tones natural.",
        "color_profile": {"highlights": "bright white", "shadows": "rich deep", "midtones": "saturated"},
        "mood": "energetic, fun, eye-catching",
        "intensity": "moderate",
    },
    {
        "name": "Soft Fade",
        "id": "soft_fade",
        "category": "vintage",
        "best_for": ["casual portrait", "lifestyle", "cafe", "brunch", "indoor warm", "cozy"],
        "description": "Lifted blacks with a slight fade, muted tones, and gentle warmth. Gives a nostalgic, film-like quality.",
        "color_profile": {"highlights": "creamy", "shadows": "faded grey", "midtones": "muted warm"},
        "mood": "nostalgic, relaxed, approachable",
        "intensity": "subtle",
    },
    {
        "name": "Noir Contrast",
        "id": "noir_contrast",
        "category": "dramatic",
        "best_for": ["black and white suitable", "dramatic lighting", "silhouette", "architecture", "tower", "monument"],
        "description": "High-contrast treatment with deep blacks and bright highlights. Can be applied as B&W or as a desaturated color grade.",
        "color_profile": {"highlights": "bright white", "shadows": "pure black", "midtones": "high contrast"},
        "mood": "dramatic, bold, artistic",
        "intensity": "strong",
    },
    {
        "name": "Tropical Warmth",
        "id": "tropical_warmth",
        "category": "warm",
        "best_for": ["beach", "pool", "resort", "tropical", "water", "ocean", "island"],
        "description": "Rich warm tones with enhanced blues in water/sky. Boosts tan skin tones and adds a vacation glow.",
        "color_profile": {"highlights": "warm yellow", "shadows": "rich brown", "midtones": "golden tan"},
        "mood": "vacation, luxurious, carefree",
        "intensity": "moderate",
    },
    {
        "name": "Urban Edge",
        "id": "urban_edge",
        "category": "cool",
        "best_for": ["city", "street", "skyline", "rooftop", "concrete", "modern architecture", "urban"],
        "description": "Slightly desaturated with teal-shifted shadows and crisp contrast. Works well with concrete, glass, and metal backgrounds.",
        "color_profile": {"highlights": "cool white", "shadows": "teal-grey", "midtones": "desaturated neutral"},
        "mood": "modern, edgy, confident",
        "intensity": "moderate",
    },
    {
        "name": "Garden Fresh",
        "id": "garden_fresh",
        "category": "natural",
        "best_for": ["garden", "park", "greenery", "botanical", "nature", "trees", "flowers", "chinese gardens", "japanese garden"],
        "description": "Enhances greens and earth tones while keeping skin warm. Adds a natural luminosity to foliage-heavy backgrounds.",
        "color_profile": {"highlights": "soft warm", "shadows": "earthy green", "midtones": "natural warm"},
        "mood": "fresh, natural, serene",
        "intensity": "subtle",
    },
    {
        "name": "Warm Film",
        "id": "warm_film",
        "category": "vintage",
        "best_for": ["restaurant", "bar", "indoor warm lighting", "candlelight", "tungsten", "evening indoor"],
        "description": "Emulates warm-toned analog film stock. Orange-shifted highlights with slightly green shadows, gentle grain texture.",
        "color_profile": {"highlights": "orange-warm", "shadows": "olive-green", "midtones": "warm neutral"},
        "mood": "intimate, artistic, authentic",
        "intensity": "moderate",
    },
    {
        "name": "Bright & Airy",
        "id": "bright_airy",
        "category": "light",
        "best_for": ["bright daylight", "white background", "minimalist", "rooftop", "terrace", "balcony", "open sky"],
        "description": "Lifts exposure, opens shadows, and adds a bright clean feel. Slight warmth in highlights with very soft contrast.",
        "color_profile": {"highlights": "bright warm", "shadows": "open light", "midtones": "lifted"},
        "mood": "light, fresh, optimistic",
        "intensity": "subtle",
    },
    {
        "name": "Dusk Cinematic",
        "id": "dusk_cinematic",
        "category": "dramatic",
        "best_for": ["dusk", "twilight", "neon", "night portrait", "city lights", "evening skyline"],
        "description": "Orange-teal split toning inspired by Hollywood color grading. Warm skin against cool backgrounds.",
        "color_profile": {"highlights": "warm orange", "shadows": "deep teal", "midtones": "balanced split"},
        "mood": "cinematic, glamorous, dramatic",
        "intensity": "strong",
    },
    {
        "name": "Natural Glow",
        "id": "natural_glow",
        "category": "natural",
        "best_for": ["natural light portrait", "window light", "soft light", "overcast daylight", "shade"],
        "description": "Very gentle enhancement that adds a soft luminous quality to skin. Minimal color shift, just improved clarity and subtle glow.",
        "color_profile": {"highlights": "soft white", "shadows": "neutral", "midtones": "skin-optimized"},
        "mood": "natural, genuine, approachable",
        "intensity": "subtle",
    },
    {
        "name": "Retro Pastel",
        "id": "retro_pastel",
        "category": "vintage",
        "best_for": ["colorful wall", "mural", "playful", "casual", "fun backdrop", "market", "food stall"],
        "description": "Softens colors into pastel range with lifted shadows and reduced contrast. Creates a dreamy retro aesthetic.",
        "color_profile": {"highlights": "pastel warm", "shadows": "lifted lavender", "midtones": "soft pastel"},
        "mood": "playful, creative, whimsical",
        "intensity": "moderate",
    },
    {
        "name": "Crystal Clear",
        "id": "crystal_clear",
        "category": "neutral",
        "best_for": ["high detail", "landscape portrait", "mountain", "water", "lake", "monument", "temple"],
        "description": "Maximum clarity and sharpness with neutral color balance. Brings out texture and detail in both subject and background.",
        "color_profile": {"highlights": "clean white", "shadows": "defined dark", "midtones": "neutral sharp"},
        "mood": "sharp, impressive, detailed",
        "intensity": "moderate",
    },
]


def get_filter_catalog() -> list[dict]:
    return FILTER_CATALOG


def get_filter_by_id(filter_id: str) -> dict | None:
    for f in FILTER_CATALOG:
        if f["id"] == filter_id:
            return f
    return None


def get_filter_names() -> list[str]:
    return [f["name"] for f in FILTER_CATALOG]


def format_recommendation(filter_entry: dict, match_reason: str) -> str:
    return (
        f"**{filter_entry['name']}** ({filter_entry['category']}) — "
        f"{filter_entry['description']} "
        f"_Why: {match_reason}_"
    )
