"""
Configuration for the Lightroom Preset Selector backend.
"""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
INPUT_DIR = DATA_DIR / "to_process"
ANALYZED_DIR = DATA_DIR / "analyzed"
ERRORED_DIR = DATA_DIR / "errored"
OUTPUT_DIR = DATA_DIR / "processed"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
RUNS_DIR = DATA_DIR / "runs"
LIBRARY_DIR = PROJECT_ROOT / "library"
LIBRARY_PATH = LIBRARY_DIR / "production_filter_library.yml"
PRESET_RECOMMENDATIONS_PATH = LIBRARY_DIR / "production_preset_recommendations.yml"

# ── Gemini Models ────────────────────────────────────────────────────────────
# State-of-the-art models only. Analysis uses Gemini 3.1 Pro Preview.
# Image enhancement uses Nano Banana 2 (gemini-3.1-flash-image-preview).

AVAILABLE_MODELS = {
    "gemini-3.1-pro-preview": {
        "display_name": "Gemini 3.1 Pro (Latest)",
        "description": "State-of-the-art reasoning and analysis. Best for metadata extraction and recommendations.",
        "input_per_1m": 2.00,
        "output_per_1m": 12.00,
        "supports_images": True,
    },
}

DEFAULT_ANALYSIS_MODEL = "gemini-3.1-pro-preview"

# ── Image Processing ─────────────────────────────────────────────────────────

MAX_ANALYSIS_SIZE_PX = 1024
THUMBNAIL_SIZE = (300, 300)
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".bmp"}
ANALYSIS_CONCURRENCY = 3
BATCH_SIZE = 20

MIN_RESOLUTION_SHORT_SIDE = 1080
TARGET_UPSCALE_RESOLUTION = 2048
EDIT_MODEL = "gemini-3.1-flash-image-preview"

# ── Cost Estimation ──────────────────────────────────────────────────────────
# Rough estimates for per-image token usage (varies by image size and model)

ESTIMATED_PROMPT_TOKENS_PER_IMAGE = 300
ESTIMATED_IMAGE_TOKENS_PER_IMAGE = 1200
ESTIMATED_OUTPUT_TOKENS_PER_IMAGE = 200
