"""
ImageStudio — Configuration.
Professional bulk image analysis and editing powered by Gemini AI.
"""

INPUT_DIR = "./to_process"
OUTPUT_DIR = "./processed"
RUNS_DIR = "./runs"

# ── Models ────────────────────────────────────────────────────────────────────

# Best Gemini model for photo understanding/analysis
ANALYSIS_MODEL = "gemini-2.5-pro"
ANALYSIS_CONCURRENCY = 5

# Nano Banana Pro — highest quality image editing & generation
EDIT_MODEL = "gemini-3-pro-image-preview"

# ── Image analysis settings ───────────────────────────────────────────────────

MAX_ANALYSIS_SIZE_PX = 1024
BATCH_SIZE = 20
TEST_SAMPLE_SIZE = 10

# ── Resolution thresholds ────────────────────────────────────────────────────

MIN_RESOLUTION_SHORT_SIDE = 1080
TARGET_UPSCALE_RESOLUTION = 2048

# ── Supported image extensions ────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".bmp"}

# ── Pricing (USD) ─────────────────────────────────────────────────────────────

PRICING = {
    "gemini-2.5-pro": {
        "input_per_1m": 1.25,
        "output_per_1m": 10.00,
    },
    "gemini-3.1-pro-preview": {
        "input_per_1m": 2.00,
        "output_per_1m": 12.00,
    },
    "gemini-3-pro-image-preview": {
        "per_image_1k": 0.134,
        "per_image_2k": 0.20,
        "per_image_4k": 0.24,
    },
}

# ── Edit operation types ──────────────────────────────────────────────────────

EDIT_TYPES = {
    "rotation": {
        "label": "Rotation Fix",
        "icon": "🔄",
        "method": "local",
        "cost": 0.0,
    },
    "upscale": {
        "label": "Resolution Upscale",
        "icon": "📐",
        "method": "api",
        "model": "gemini-3-pro-image-preview",
    },
    "filter": {
        "label": "Filter Enhancement",
        "icon": "✨",
        "method": "api",
        "model": "gemini-3-pro-image-preview",
    },
}
