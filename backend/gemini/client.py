"""
Gemini API client for photo metadata extraction.

This module handles all communication with the Google Gemini API.
It sends a photo + prompt, and gets back structured metadata (JSON).
"""
import asyncio
import io
import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image

from backend import config
from backend.gemini.parser import parse_metadata_response
from prompts.metadata_prompt import METADATA_PROMPT

load_dotenv(config.PROJECT_ROOT / ".env")

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


def _get_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "No API key found. Add GEMINI_API_KEY=your_key to the .env file "
            "in the project root."
        )
    return key


def _prepare_image(path: Path) -> tuple[bytes, str]:
    """Fix orientation, resize for analysis, and convert to JPEG bytes."""
    from backend.images.processor import fix_orientation
    img = Image.open(path)
    try:
        img = fix_orientation(img)
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > config.MAX_ANALYSIS_SIZE_PX:
            ratio = config.MAX_ANALYSIS_SIZE_PX / max(w, h)
            img = img.resize(
                (int(w * ratio), int(h * ratio)),
                Image.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    finally:
        img.close()


def _extract_token_usage(response) -> dict:
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    try:
        meta = response.usage_metadata
        if meta:
            usage["prompt_tokens"] = getattr(meta, "prompt_token_count", 0) or 0
            usage["completion_tokens"] = getattr(meta, "candidates_token_count", 0) or 0
            usage["total_tokens"] = getattr(meta, "total_token_count", 0) or 0
    except Exception:
        pass
    return usage


async def analyze_photo(
    path: Path,
    model_name: str | None = None,
    semaphore: asyncio.Semaphore | None = None,
) -> dict:
    """
    Send a photo to Gemini and get back structured metadata.

    Returns a dict with:
      - metadata: the 6 extracted fields (or None on failure)
      - token_usage: prompt/completion/total token counts
      - error: error message string (or None on success)
    """
    model = model_name or config.DEFAULT_ANALYSIS_MODEL
    api_key = _get_api_key()
    client = genai.Client(api_key=api_key)

    try:
        image_bytes, mime_type = _prepare_image(path)
    except Exception as e:
        return {"metadata": None, "token_usage": {}, "error": f"Image load failed: {e}"}

    def _parse_retry_delay(err_str: str) -> float:
        """Extract retryDelay seconds from a Gemini 429 error string. Returns 0 if not found."""
        import re
        # The SDK surfaces the error detail which may contain e.g. "retryDelay: '33s'"
        match = re.search(r"retrydelay['\"]?\s*[:=]\s*['\"]?(\d+(?:\.\d+)?)", err_str)
        if match:
            return min(float(match.group(1)), 60.0)
        return 0.0

    async def _call():
        async with client.aio as aclient:
            for attempt in range(3):
                try:
                    contents = [
                        types.Part.from_text(text=METADATA_PROMPT),
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    ]
                    response = await aclient.models.generate_content(
                        model=model,
                        contents=contents,
                    )
                    usage = _extract_token_usage(response)
                    text = response.text if response else None
                    if not text:
                        return {
                            "metadata": None,
                            "token_usage": usage,
                            "error": "Gemini returned empty response",
                        }
                    parsed = parse_metadata_response(text)
                    if parsed is None:
                        return {
                            "metadata": None,
                            "token_usage": usage,
                            "error": "Failed to parse Gemini response as valid metadata",
                        }
                    return {"metadata": parsed, "token_usage": usage, "error": None}
                except Exception as e:
                    err_str = str(e).lower()
                    is_rate_limit = "429" in err_str or "resource_exhausted" in err_str
                    retryable = is_rate_limit or any(
                        k in err_str for k in ("500", "internal")
                    )
                    if retryable and attempt < 2:
                        if is_rate_limit:
                            delay = _parse_retry_delay(err_str) or (15 * (attempt + 1))
                        else:
                            delay = 5 * (attempt + 1)
                        await asyncio.sleep(delay)
                        continue
                    return {
                        "metadata": None,
                        "token_usage": {},
                        "error": f"Gemini API error: {e}",
                    }
            return {
                "metadata": None,
                "token_usage": {},
                "error": "Max retries exceeded",
            }

    if semaphore:
        async with semaphore:
            return await _call()
    return await _call()


def estimate_cost(model_name: str, num_images: int) -> dict:
    """Estimate the cost of analyzing a batch of images."""
    model_info = config.AVAILABLE_MODELS.get(model_name, {})
    input_price = model_info.get("input_per_1m", 0)
    output_price = model_info.get("output_per_1m", 0)

    input_tokens = (
        config.ESTIMATED_PROMPT_TOKENS_PER_IMAGE
        + config.ESTIMATED_IMAGE_TOKENS_PER_IMAGE
    ) * num_images
    output_tokens = config.ESTIMATED_OUTPUT_TOKENS_PER_IMAGE * num_images

    input_cost = input_tokens * input_price / 1_000_000
    output_cost = output_tokens * output_price / 1_000_000

    return {
        "model": model_name,
        "num_images": num_images,
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": round(input_cost + output_cost, 4),
    }
