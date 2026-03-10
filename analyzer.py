"""
ImageStudio — AI-powered photo analysis.
Uses Gemini 2.5 Pro to analyze photos for orientation, quality, and editing suggestions.
Builds per-image recommendations with cost estimates.
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


# ── Utilities ─────────────────────────────────────────────────────────────────

def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_image_paths(input_dir: Path) -> list[Path]:
    paths = []
    for ext in config.SUPPORTED_EXTENSIONS:
        paths.extend(input_dir.rglob(f"*{ext}"))
        paths.extend(input_dir.rglob(f"*{ext.upper()}"))
    seen = set()
    unique = []
    for p in sorted(paths, key=lambda p: str(p).lower()):
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            unique.append(p)
    return unique


# ── Local metadata extraction (free) ─────────────────────────────────────────

def get_image_metadata(path: Path) -> dict:
    try:
        ext = path.suffix.lower()
        if ext == ".heic":
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except Exception:
                pass
        img = Image.open(path)
        width, height = img.size

        exif_rotation = 0
        try:
            exif = img.getexif()
            orientation = exif.get(ExifBase.Orientation, 1)
            exif_rotation_map = {1: 0, 3: 180, 6: 90, 8: 270}
            exif_rotation = exif_rotation_map.get(orientation, 0)
        except Exception:
            pass

        short_side = min(width, height)
        needs_upscale = short_side < config.MIN_RESOLUTION_SHORT_SIDE

        return {
            "width": width,
            "height": height,
            "short_side": short_side,
            "exif_rotation": exif_rotation,
            "needs_upscale": needs_upscale,
            "file_size_kb": round(path.stat().st_size / 1024, 1),
        }
    except Exception as e:
        return {
            "width": 0, "height": 0, "short_side": 0,
            "exif_rotation": 0, "needs_upscale": False,
            "file_size_kb": 0, "error": str(e),
        }


# ── Image preparation ────────────────────────────────────────────────────────

def load_and_prepare_image(path: Path) -> tuple[bytes, str] | None:
    try:
        ext = path.suffix.lower()
        if ext == ".heic":
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except Exception:
                pass
        img = Image.open(path).convert("RGB")
        w, h = img.size
        if max(w, h) > config.MAX_ANALYSIS_SIZE_PX:
            ratio = config.MAX_ANALYSIS_SIZE_PX / max(w, h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return None


# ── AI Analysis Prompt ────────────────────────────────────────────────────────

ANALYSIS_PROMPT = """You are a professional dating profile photo editor analyzing images for a client.

The image resolution is {width}x{height} pixels.

Respond with ONLY a valid JSON object (no markdown fences, no extra text):
{{
  "orientation": {{
    "is_correct": true,
    "rotation_needed_degrees": 0,
    "confidence": "high",
    "reason": null
  }},
  "filters": {{
    "needs_editing": false,
    "suggestions": [],
    "overall_quality": "good",
    "assessment": "Brief quality assessment"
  }},
  "description": "One sentence describing this photo",
  "is_good_for_dating_profile": true,
  "profile_tips": null
}}

For filter suggestions, each item in the array should be:
{{
  "type": "color_correction|brightness|contrast|warmth|saturation|sharpening|background_blur|skin_smoothing|vignette|hdr|cinematic|portrait_lighting",
  "description": "What to adjust and why",
  "intensity": "subtle|moderate|strong",
  "edit_prompt": "Exact instruction for an AI image editor"
}}

CRITICAL GUIDELINES:
- Only suggest rotation if the image is CLEARLY sideways or upside down. Most photos are correctly oriented.
- Only suggest filters that would MEANINGFULLY improve the photo. Not every photo needs editing.
- Be highly selective — like a real professional editor, only recommend changes that truly matter.
- If the photo already looks great, say so with needs_editing: false and an empty suggestions array.
- Filter edit_prompts must be specific, actionable instructions.
- rotation_needed_degrees must be exactly 0, 90, 180, or 270.
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
            "is_good_for_dating_profile": None,
            "profile_tips": None,
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


# ── Recommendation builder ────────────────────────────────────────────────────

def build_recommendations(metadata: dict, analysis: dict) -> list[dict]:
    recs = []

    orientation = analysis.get("orientation", {})
    rotation_degrees = orientation.get("rotation_needed_degrees", 0)
    if not orientation.get("is_correct", True) and rotation_degrees in (90, 180, 270):
        recs.append({
            "type": "rotation",
            "label": f"Rotate {rotation_degrees}\u00b0",
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
            "label": f"Upscale ({short_side}px \u2192 {target}px)",
            "description": (
                f"Resolution is {metadata['width']}\u00d7{metadata['height']}. "
                f"Short side ({short_side}px) is below {config.MIN_RESOLUTION_SHORT_SIDE}px threshold."
            ),
            "confidence": "high",
            "method": "api",
            "model": config.EDIT_MODEL,
            "estimated_cost": edit_pricing.get("per_image_2k", 0.20),
            "params": {"target_resolution": target},
        })

    filters = analysis.get("filters", {})
    if filters.get("needs_editing", False):
        suggestions = filters.get("suggestions", [])
        if suggestions:
            edit_prompts = [s.get("edit_prompt", s.get("description", "")) for s in suggestions]
            combined_prompt = "; ".join(p for p in edit_prompts if p)
            descriptions = [
                f"\u2022 {s.get('type', 'edit')}: {s.get('description', '')}"
                for s in suggestions
            ]
            edit_pricing = config.PRICING.get(config.EDIT_MODEL, {})
            recs.append({
                "type": "filter",
                "label": f"{len(suggestions)} filter(s) suggested",
                "description": "\n".join(descriptions),
                "confidence": "medium",
                "method": "api",
                "model": config.EDIT_MODEL,
                "estimated_cost": edit_pricing.get("per_image_2k", 0.20),
                "params": {
                    "edit_prompt": combined_prompt,
                    "suggestions": suggestions,
                },
            })

    return recs


# ── Cost estimation ───────────────────────────────────────────────────────────

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


# ── Single image analysis ─────────────────────────────────────────────────────

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


# ── Batch analysis ────────────────────────────────────────────────────────────

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
            result = {
                "filename": p.name,
                "original_path": str(p),
                "file_hash": fhash,
                "metadata": metadata,
                "analysis": analysis,
                "recommendations": recommendations,
                "description": analysis.get("description"),
                "is_good_for_dating_profile": analysis.get("is_good_for_dating_profile"),
                "profile_tips": analysis.get("profile_tips"),
                "quality": analysis.get("filters", {}).get("overall_quality", "unknown"),
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
