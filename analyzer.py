"""
ImageStudio — AI-powered photo analysis.
Uses Gemini to analyze photos for orientation, quality, and editing suggestions.
"""
import asyncio
import hashlib
import io
import json
import os
import re
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
from PIL.ExifTags import Base as ExifBase

import config

load_dotenv()

# Register HEIC support once at import time
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_image_paths(input_dir: Path) -> list[Path]:
    """Single-pass scan that catches all case variations (.jpg, .JPG, .Jpg, etc.)."""
    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    paths = [
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in exts
    ]
    seen: set[Path] = set()
    unique: list[Path] = []
    for p in sorted(paths, key=lambda x: str(x).lower()):
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            unique.append(p)
    return unique


def get_image_metadata(path: Path) -> dict:
    try:
        img = Image.open(path)
        try:
            width, height = img.size
            exif_rotation = 0
            try:
                exif = img.getexif()
                orientation = exif.get(ExifBase.Orientation, 1)
                exif_rotation = {1: 0, 3: 180, 6: 90, 8: 270}.get(orientation, 0)
            except Exception:
                pass
            short_side = min(width, height)
            return {
                "width": width,
                "height": height,
                "short_side": short_side,
                "exif_rotation": exif_rotation,
                "needs_upscale": short_side < config.MIN_RESOLUTION_SHORT_SIDE,
                "file_size_kb": round(path.stat().st_size / 1024, 1),
            }
        finally:
            img.close()
    except Exception as e:
        return {
            "width": 0, "height": 0, "short_side": 0,
            "exif_rotation": 0, "needs_upscale": False,
            "file_size_kb": 0, "error": str(e),
        }


def load_and_prepare_image(path: Path) -> tuple[bytes, str] | None:
    try:
        img = Image.open(path)
        try:
            img = img.convert("RGB")
            w, h = img.size
            if max(w, h) > config.MAX_ANALYSIS_SIZE_PX:
                ratio = config.MAX_ANALYSIS_SIZE_PX / max(w, h)
                img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return buf.getvalue(), "image/jpeg"
        finally:
            img.close()
    except Exception:
        return None


ANALYSIS_PROMPT = """You are a professional photo editor analyzing profile photos for a client.

The image resolution is {width}x{height} pixels.

Respond with ONLY a valid JSON object (no markdown fences, no extra text):
{{
  "orientation": {{
    "is_correct": true,
    "rotation_needed_degrees": 0,
    "confidence": "high",
    "reason": null
  }},
  "scene": {{
    "setting": "Brief description of the setting/location (e.g. pool resort, Chinese gardens, urban rooftop, beach sunset)",
    "lighting": "Type of lighting (e.g. natural daylight, golden hour, overcast, indoor warm, studio, night/neon, mixed)",
    "dominant_colors": ["list", "of", "dominant", "colors"],
    "mood": "Overall mood/feel of the image",
    "background_type": "What's behind the subject (e.g. greenery, water, architecture, sky, indoor, urban)"
  }},
  "quality": {{
    "overall": "excellent|good|fair|poor",
    "assessment": "Brief quality assessment of exposure, white balance, sharpness",
    "issues": ["list any issues like underexposed, overexposed, soft focus, color cast, etc."]
  }},
  "suggested_name": "A short descriptive name for this photo based on what's visible. Use format like: Pool Resort, Chinese Gardens, City Skyline, Beach Sunset, Rooftop View, Garden Portrait. Keep it 2-4 words, common sense, descriptive.",
  "description": "One sentence describing this photo"
}}

CRITICAL GUIDELINES:
- Only suggest rotation if the image is CLEARLY sideways or upside down.
- rotation_needed_degrees must be exactly 0, 90, 180, or 270.
- For suggested_name: be practical and descriptive. These are profile photos, so think about the setting/backdrop. Examples: Pool Resort, Chinese Gardens, Tower View, Urban Skyline, Beach Sunset, Garden Path, Restaurant Terrace, Hotel Lobby.
- For scene analysis: be specific about colors, lighting type, and setting — this will be used to match appropriate photo filters.
"""

FILTER_MATCHING_PROMPT = """You are a photo filter expert. Based on the following image analysis and filter catalog, recommend the top 2 best filters for this profile photo.

IMAGE ANALYSIS:
- Setting: {setting}
- Lighting: {lighting}
- Dominant colors: {dominant_colors}
- Mood: {mood}
- Background: {background_type}
- Quality: {quality} — {assessment}
- Quality issues: {issues}
- Description: {description}

AVAILABLE FILTERS:
{filter_catalog}

Respond with ONLY a valid JSON object (no markdown fences, no extra text):
{{
  "recommendations": [
    {{
      "filter_id": "the filter id from the catalog",
      "match_reason": "Why this filter is the best match for this specific photo — reference the scene, colors, and lighting"
    }},
    {{
      "filter_id": "second best filter id",
      "match_reason": "Why this is the second best match"
    }}
  ]
}}

GUIDELINES:
- Pick filters whose best_for tags closely match the scene setting and lighting.
- Consider the dominant colors and how the filter's color_profile would complement them.
- Consider the quality issues — if the photo has issues, pick filters that would help.
- Always recommend exactly 2 filters, ranked by best match first.
"""


def parse_analysis_response(text: str) -> dict:
    text = (text or "").strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        return {
            "orientation": {
                "is_correct": True, "rotation_needed_degrees": 0,
                "confidence": "low", "reason": f"Parse error: {e}",
            },
            "filters": {
                "needs_editing": False, "suggestions": [],
                "overall_quality": "unknown", "assessment": "Could not parse AI response",
            },
            "description": None,
            "parse_error": str(e),
        }


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


def build_recommendations(metadata: dict, analysis: dict) -> list[dict]:
    recs = []

    orientation = analysis.get("orientation", {})
    rotation_degrees = orientation.get("rotation_needed_degrees", 0)
    if not orientation.get("is_correct", True) and rotation_degrees in (90, 180, 270):
        recs.append({
            "type": "rotation",
            "label": f"Rotate {rotation_degrees}°",
            "description": orientation.get("reason") or "Image appears incorrectly oriented",
            "confidence": orientation.get("confidence", "medium"),
            "method": "local",
            "model": None,
            "estimated_cost": 0.0,
            "params": {"degrees": rotation_degrees},
        })

    if metadata.get("needs_upscale", False):
        short_side = metadata.get("short_side", 0)
        target = config.TARGET_UPSCALE_RESOLUTION
        edit_pricing = config.PRICING.get(config.EDIT_MODEL, {})
        recs.append({
            "type": "upscale",
            "label": f"Upscale ({short_side}px → {target}px)",
            "description": (
                f"Resolution is {metadata['width']}×{metadata['height']}. "
                f"Short side ({short_side}px) is below {config.MIN_RESOLUTION_SHORT_SIDE}px threshold."
            ),
            "confidence": "high",
            "method": "api",
            "model": config.EDIT_MODEL,
            "estimated_cost": edit_pricing.get("per_image_2k", 0.20),
            "params": {"target_resolution": target},
        })

    return recs


async def match_filters_for_image(
    aclient,
    analysis: dict,
    semaphore: asyncio.Semaphore,
) -> tuple[list[dict], dict]:
    """Cross-reference image analysis with filter research report to find top 2 filters."""
    from filter_report import FILTER_CATALOG, get_filter_by_id

    empty_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    scene = analysis.get("scene", {})
    quality = analysis.get("quality", {})

    catalog_text = ""
    for f in FILTER_CATALOG:
        catalog_text += (
            f"- {f['name']} (id: {f['id']}, category: {f['category']})\n"
            f"  Best for: {', '.join(f['best_for'])}\n"
            f"  Description: {f['description']}\n"
            f"  Color profile: highlights={f['color_profile']['highlights']}, "
            f"shadows={f['color_profile']['shadows']}, midtones={f['color_profile']['midtones']}\n"
            f"  Mood: {f['mood']}\n"
            f"  Intensity: {f['intensity']}\n\n"
        )

    prompt = FILTER_MATCHING_PROMPT.format(
        setting=scene.get("setting", "unknown"),
        lighting=scene.get("lighting", "unknown"),
        dominant_colors=", ".join(scene.get("dominant_colors", [])),
        mood=scene.get("mood", "unknown"),
        background_type=scene.get("background_type", "unknown"),
        quality=quality.get("overall", "unknown"),
        assessment=quality.get("assessment", ""),
        issues=", ".join(quality.get("issues", [])) or "none",
        description=analysis.get("description", ""),
        filter_catalog=catalog_text,
    )

    async with semaphore:
        for attempt in range(3):
            try:
                contents = [types.Part.from_text(text=prompt)]
                response = await aclient.models.generate_content(
                    model=config.ANALYSIS_MODEL,
                    contents=contents,
                )
                usage = _extract_token_usage(response)
                text = response.text if response else None
                if not text:
                    return [], usage

                parsed = parse_analysis_response(text)
                raw_recs = parsed.get("recommendations", [])
                matched_filters = []
                for rec in raw_recs[:2]:
                    filt = get_filter_by_id(rec.get("filter_id", ""))
                    if filt:
                        matched_filters.append({
                            "filter": filt,
                            "match_reason": rec.get("match_reason", ""),
                        })
                return matched_filters, usage
            except Exception as e:
                err_str = str(e).lower()
                retryable = any(k in err_str for k in ("429", "500", "resource_exhausted", "internal"))
                if retryable and attempt < 2:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                return [], empty_usage
    return [], empty_usage


def estimate_analysis_cost(token_usage: dict) -> float:
    pricing = config.PRICING.get(config.ANALYSIS_MODEL, {})
    input_cost = token_usage.get("prompt_tokens", 0) * pricing.get("input_per_1m", 0) / 1_000_000
    output_cost = token_usage.get("completion_tokens", 0) * pricing.get("output_per_1m", 0) / 1_000_000
    return input_cost + output_cost


def estimate_total_edit_cost(images: list[dict]) -> float:
    total = 0.0
    for img in images:
        approved = img.get("approved_edits", [])
        for rec in img.get("recommendations", []):
            if rec["type"] in approved:
                total += rec.get("estimated_cost", 0)
    return total


async def analyze_one(
    aclient,
    path: Path,
    metadata: dict,
    semaphore: asyncio.Semaphore,
) -> tuple[dict | None, str | None, dict]:
    empty_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    async with semaphore:
        prepared = load_and_prepare_image(path)
        if prepared is None:
            return None, f"Could not load image: {path}", empty_usage
        image_bytes, mime_type = prepared

        prompt = ANALYSIS_PROMPT.format(
            width=metadata.get("width", "unknown"),
            height=metadata.get("height", "unknown"),
        )

        for attempt in range(3):
            try:
                contents = [
                    types.Part.from_text(text=prompt),
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ]
                response = await aclient.models.generate_content(
                    model=config.ANALYSIS_MODEL,
                    contents=contents,
                )
                usage = _extract_token_usage(response)
                text = response.text if response else None
                if not text:
                    return None, f"No response from model: {path}", usage
                parsed = parse_analysis_response(text)
                return parsed, None, usage
            except Exception as e:
                err_str = str(e).lower()
                retryable = any(k in err_str for k in ("429", "500", "resource_exhausted", "internal"))
                if retryable and attempt < 2:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                return None, f"{path}: {e}", empty_usage
        return None, f"Max retries exceeded: {path}", empty_usage


async def analyze_batch(
    paths: list[Path],
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[list[dict], list[dict], dict]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set in environment or .env")

    client = genai.Client(api_key=api_key)
    semaphore = asyncio.Semaphore(config.ANALYSIS_CONCURRENCY)
    results: list[dict] = []
    errors: list[dict] = []
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    completed = [0]
    total = len(paths)

    async def task(p: Path):
        try:
            fhash = file_hash(p)
        except Exception as e:
            return p, None, f"Hash error: {e}", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, ""
        try:
            metadata = get_image_metadata(p)
        except Exception as e:
            return p, None, f"Metadata error: {e}", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, fhash
        analysis, err, usage = await analyze_one(aclient, p, metadata, semaphore)
        completed[0] += 1
        if progress_callback:
            progress_callback(completed[0], total)
        if analysis:
            recommendations = build_recommendations(metadata, analysis)

            filter_matches, filter_usage = await match_filters_for_image(
                aclient, analysis, semaphore
            )
            for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                usage[k] += filter_usage.get(k, 0)

            suggested_name = analysis.get("suggested_name", "")
            if not suggested_name:
                suggested_name = (analysis.get("description") or p.stem)[:40]

            result = {
                "filename": p.name,
                "original_path": str(p),
                "file_hash": fhash,
                "metadata": metadata,
                "analysis": analysis,
                "recommendations": recommendations,
                "filter_recommendations": filter_matches,
                "suggested_name": suggested_name,
                "description": analysis.get("description"),
                "quality": analysis.get("quality", {}).get("overall", "unknown"),
                "estimated_edit_cost": sum(r.get("estimated_cost", 0) for r in recommendations),
                "approved_edits": [],
            }
            return p, result, None, usage, fhash
        return p, None, err, usage, fhash

    async with client.aio as aclient:
        tasks = [task(p) for p in paths]
        done = await asyncio.gather(*tasks, return_exceptions=True)

    for idx, outcome in enumerate(done):
        if isinstance(outcome, BaseException):
            p = paths[idx] if idx < len(paths) else None
            errors.append({
                "path": str(p) if p else "?",
                "filename": p.name if p else "?",
                "error": str(outcome),
            })
            continue
        path, res, err, usage, fhash = outcome
        for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
            total_usage[k] += usage.get(k, 0)
        if err:
            errors.append({"path": str(path), "filename": path.name, "file_hash": fhash, "error": err})
            continue
        if res:
            results.append(res)

    return results, errors, total_usage
