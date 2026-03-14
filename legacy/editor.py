"""
ImageStudio — Edit operations.
Applies rotation (local/free) and resolution upscaling (API).
Filters are recommendation-only and never applied.
Originals are NEVER modified — all operations work on copies.
"""
import io
import os
import re
import shutil
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image

import config

load_dotenv()

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


def _open_image(path: Path) -> Image.Image:
    return Image.open(path)


def _image_to_jpeg_bytes(img: Image.Image, quality: int = 95) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _save_format(path: Path) -> str:
    fmt_map = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}
    return fmt_map.get(path.suffix.lower(), "JPEG")


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    return genai.Client(api_key=api_key)


def _extract_image_from_response(response) -> bytes | None:
    try:
        if not response.candidates:
            return None
        parts = response.candidates[0].content.parts
        for part in parts:
            if hasattr(part, "inline_data") and part.inline_data:
                return part.inline_data.data
    except (IndexError, AttributeError):
        pass
    return None


def _sanitize_filename(name: str) -> str:
    """Turn a suggested name into a safe filename component."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    name = name.title()
    if not name:
        name = "Photo"
    return name


def build_output_name(image_data: dict, suffix: str = "") -> str:
    """Build a descriptive output filename from analysis data.

    Example: "Profile Photo - Pool Resort.jpg"
    """
    suggested = image_data.get("suggested_name", "")
    if not suggested:
        suggested = image_data.get("filename", "photo")
        suggested = Path(suggested).stem

    safe_name = _sanitize_filename(suggested)
    ext = Path(image_data.get("filename", "photo.jpg")).suffix.lower() or ".jpg"

    if suffix:
        return f"Profile Photo - {safe_name}{suffix}{ext}"
    return f"Profile Photo - {safe_name}{ext}"


def rotate_image(path: Path, degrees: int, output_path: Path) -> Path:
    img = _open_image(path)
    try:
        rotated = img.rotate(-degrees, expand=True)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        rotated.save(str(output_path), format=_save_format(path), quality=95)
    finally:
        img.close()
    return output_path


def preview_rotation(path: Path, degrees: int) -> Image.Image:
    """Return a rotated PIL Image for preview (does NOT save to disk)."""
    img = _open_image(path)
    try:
        rotated = img.rotate(-degrees, expand=True)
        rotated.thumbnail((600, 600))
        return rotated.copy()
    finally:
        img.close()


def upscale_image(path: Path, output_path: Path, target_resolution: int | None = None) -> Path:
    client = _get_client()
    img = _open_image(path)
    try:
        image_bytes = _image_to_jpeg_bytes(img.convert("RGB"))
    finally:
        img.close()

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


def preview_upscale(path: Path) -> Path:
    """Upscale a single image to a temp preview file and return the path.

    This lets the user see the result before batch-processing.
    """
    preview_dir = Path(config.OUTPUT_DIR) / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    preview_path = preview_dir / f"preview_upscale_{path.stem}.jpg"
    return upscale_image(path, preview_path)


def apply_edits(image_data: dict, output_dir: Path) -> dict:
    """Apply approved edits to a COPY of the image. Original is never modified."""
    original = Path(image_data["original_path"])
    approved = set(image_data.get("approved_edits", []))
    recommendations = image_data.get("recommendations", [])

    output_name = build_output_name(image_data)
    stem = Path(output_name).stem
    suffix = Path(output_name).suffix or ".jpg"

    result = {
        "filename": image_data["filename"],
        "output_name": output_name,
        "original_path": str(original),
        "edits_applied": [],
        "errors": [],
        "output_path": None,
    }

    if not approved:
        if image_data.get("approved_rename", False):
            final_out = output_dir / output_name
            final_out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(original), str(final_out))
            result["output_path"] = str(final_out)
            result["edits_applied"].append({
                "type": "rename",
                "cost": 0.0,
                "output": str(final_out),
            })
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

        except Exception as e:
            result["errors"].append({"type": rec["type"], "error": str(e)})

    if result["edits_applied"] and current_path != original and current_path.exists():
        final_out = output_dir / output_name
        final_out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(current_path), str(final_out))
        result["output_path"] = str(final_out)

    return result
