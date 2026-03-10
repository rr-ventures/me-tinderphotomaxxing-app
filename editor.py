"""
ImageStudio — Edit operations.
Applies rotation (local/free), resolution upscaling, and filter enhancements
via Nano Banana Pro (gemini-3-pro-image-preview).
"""
import io
import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image

import config

load_dotenv()


def _open_image(path: Path) -> Image.Image:
    ext = path.suffix.lower()
    if ext == ".heic":
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except Exception:
            pass
    return Image.open(path)


def _image_to_jpeg_bytes(img: Image.Image, quality: int = 95) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _save_format(path: Path) -> str:
    ext = path.suffix.lower()
    fmt_map = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}
    return fmt_map.get(ext, "JPEG")


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return genai.Client(api_key=api_key)


def _extract_image_from_response(response) -> bytes | None:
    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data:
            return part.inline_data.data
    return None


# ── Rotation (local, free) ───────────────────────────────────────────────────

def rotate_image(path: Path, degrees: int, output_path: Path) -> Path:
    img = _open_image(path)
    rotated = img.rotate(-degrees, expand=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rotated.save(str(output_path), format=_save_format(path), quality=95)
    return output_path


# ── Resolution upscale (Nano Banana Pro API) ─────────────────────────────────

def upscale_image(path: Path, output_path: Path, target_resolution: int | None = None) -> Path:
    client = _get_client()
    img = _open_image(path).convert("RGB")
    image_bytes = _image_to_jpeg_bytes(img)

    prompt = (
        "Upscale and enhance this photo to higher resolution. "
        "Preserve all original details, colors, and composition exactly. "
        "Increase clarity and sharpness while maintaining a natural look. "
        "Do not alter the content, style, or mood of the photo in any way."
    )

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                types.Part.from_text(text=prompt),
            ],
        )
    ]

    response = client.models.generate_content(
        model=config.EDIT_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )

    image_data = _extract_image_from_response(response)
    if not image_data:
        raise RuntimeError(f"No image returned from API for upscale of {path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(image_data)
    return output_path


# ── Filter enhancement (Nano Banana Pro API) ─────────────────────────────────

def apply_filters(path: Path, output_path: Path, edit_prompt: str) -> Path:
    client = _get_client()
    img = _open_image(path).convert("RGB")
    image_bytes = _image_to_jpeg_bytes(img)

    prompt = (
        "You are a professional dating profile photo editor. "
        "Apply the following edits to this photo while preserving the subject and composition: "
        f"{edit_prompt}. "
        "Make the adjustments look natural and professional, as if done by an expert photographer."
    )

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                types.Part.from_text(text=prompt),
            ],
        )
    ]

    response = client.models.generate_content(
        model=config.EDIT_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )

    image_data = _extract_image_from_response(response)
    if not image_data:
        raise RuntimeError(f"No image returned from API for filter edit of {path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(image_data)
    return output_path


# ── Apply all approved edits for one image ────────────────────────────────────

def apply_edits(image_data: dict, output_dir: Path) -> dict:
    """
    Apply all approved edits for a single image in sequence.
    Returns a result dict with status, output paths, and any errors.
    """
    original = Path(image_data["original_path"])
    approved = set(image_data.get("approved_edits", []))
    recommendations = image_data.get("recommendations", [])
    stem = original.stem
    suffix = original.suffix.lower() or ".jpg"

    result = {
        "filename": image_data["filename"],
        "original_path": str(original),
        "edits_applied": [],
        "errors": [],
        "output_path": None,
    }

    if not approved:
        return result

    current_path = original
    edit_dir = output_dir / "edits" / stem
    edit_dir.mkdir(parents=True, exist_ok=True)

    for rec in recommendations:
        if rec["type"] not in approved:
            continue

        try:
            if rec["type"] == "rotation":
                out = edit_dir / f"{stem}_rotated{suffix}"
                rotate_image(current_path, rec["params"]["degrees"], out)
                current_path = out
                result["edits_applied"].append({
                    "type": "rotation",
                    "degrees": rec["params"]["degrees"],
                    "cost": 0.0,
                    "output": str(out),
                })

            elif rec["type"] == "upscale":
                out = edit_dir / f"{stem}_upscaled{suffix}"
                upscale_image(current_path, out, rec["params"].get("target_resolution"))
                current_path = out
                result["edits_applied"].append({
                    "type": "upscale",
                    "cost": rec.get("estimated_cost", 0),
                    "output": str(out),
                })

            elif rec["type"] == "filter":
                out = edit_dir / f"{stem}_filtered{suffix}"
                prompt = rec["params"].get("edit_prompt", "")
                apply_filters(current_path, out, prompt)
                current_path = out
                result["edits_applied"].append({
                    "type": "filter",
                    "cost": rec.get("estimated_cost", 0),
                    "output": str(out),
                })

        except Exception as e:
            result["errors"].append({"type": rec["type"], "error": str(e)})

    final_out = output_dir / f"{stem}_final{suffix}"
    if current_path != original and current_path.exists():
        import shutil
        shutil.copy2(str(current_path), str(final_out))
        result["output_path"] = str(final_out)
    elif current_path == original:
        result["output_path"] = str(original)

    return result
