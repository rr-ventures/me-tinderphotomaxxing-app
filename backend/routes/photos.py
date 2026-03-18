"""
Photo endpoints — scanning, listing, serving, rotating, cropping, editing, and upscaling.
"""
import hashlib
import io
import os
import shutil
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Body, UploadFile, File
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

from backend import config
from backend.images.scanner import scan_image_paths, scan_all_image_paths, get_image_info, count_photos_by_folder
from backend.images.thumbnails import get_or_create_thumbnail
from backend.images.processor import fix_orientation
from backend.images.editor import apply_adjustments, crop_image, parse_all_sliders

load_dotenv(config.PROJECT_ROOT / ".env")

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

router = APIRouter(tags=["photos"])


def _photo_id(path: Path) -> str:
    return hashlib.md5(str(path.resolve()).encode()).hexdigest()[:12]


def _find_photo(photo_id: str) -> Path | None:
    for path in scan_all_image_paths():
        if _photo_id(path) == photo_id:
            return path
    return None


def _sanitize_preset_name(name: str) -> str:
    """Turn a preset name like 'Adaptive: Subject > Pop' into 'Adaptive_Subject_Pop'."""
    cleaned = "".join(c if c.isalnum() or c in " _" else " " for c in name)
    return "_".join(part for part in cleaned.split() if part)


def _get_preset_filename(photo_id: str, run_id: str | None, filename: str | None = None) -> str | None:
    """Look up the top preset recommendation for a photo from a run and return a sanitized filename."""
    if not run_id:
        return None
    run_result = _find_run_result(run_id, photo_id, filename)
    if not run_result:
        return None
    rec = run_result.get("preset_recommendation")
    if rec and rec.get("preset", {}).get("name"):
        return _sanitize_preset_name(rec["preset"]["name"])
    return None


def _find_run_result(run_id: str, photo_id: str, filename: str | None = None) -> dict | None:
    """
    Look up a photo's result in a run JSON.
    Tries image_id first; falls back to filename match so results survive
    path changes across environments or server restarts.
    """
    import json as _json
    run_path = config.RUNS_DIR / f"{run_id}.json"
    if not run_path.exists():
        return None
    with open(run_path, "r") as f:
        run_data = _json.load(f)
    for r in run_data.get("results", []):
        if r.get("image_id") == photo_id:
            return r
    if filename:
        for r in run_data.get("results", []):
            if r.get("filename") == filename:
                return r
    return None


def _unique_path(directory: Path, stem: str, suffix: str = ".jpg") -> Path:
    """Return a unique file path, appending _2, _3, etc. if the name already exists."""
    out = directory / f"{stem}{suffix}"
    counter = 2
    while out.exists():
        out = directory / f"{stem}_{counter}{suffix}"
        counter += 1
    return out


MEDIA_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".heic": "image/heic", ".tiff": "image/tiff",
    ".bmp": "image/bmp",
}


@router.get("/photos")
async def list_photos():
    import asyncio
    import concurrent.futures

    config.INPUT_DIR.mkdir(parents=True, exist_ok=True)
    config.ANALYZED_DIR.mkdir(parents=True, exist_ok=True)
    paths = scan_image_paths(include_analyzed=True)

    def _build_photo_entry(path: Path) -> dict:
        photo_id = _photo_id(path)
        info = get_image_info(path)
        thumb_path = config.THUMBNAILS_DIR / f"{photo_id}.jpg"
        if thumb_path.exists():
            thumbnail_url = f"/thumbnails/{photo_id}.jpg"
        else:
            try:
                get_or_create_thumbnail(path)
                thumbnail_url = f"/thumbnails/{photo_id}.jpg"
            except Exception:
                thumbnail_url = None

        # Determine which pipeline folder this photo is in
        parent = path.parent.resolve()
        if parent == config.INPUT_DIR.resolve():
            folder = "to_process"
        elif parent == config.ANALYZED_DIR.resolve():
            folder = "analyzed"
        elif parent == config.ERRORED_DIR.resolve():
            folder = "errored"
        elif parent == config.ARCHIVED_DIR.resolve():
            folder = "archived"
        else:
            folder = "other"

        return {
            "id": photo_id,
            "filename": path.name,
            "path": str(path),
            "folder": folder,
            "width": info.get("width", 0),
            "height": info.get("height", 0),
            "size_kb": info.get("size_kb", 0),
            "format": info.get("format", "unknown"),
            "thumbnail_url": thumbnail_url,
            "needs_rotation": info.get("needs_rotation", False),
            "rotation_degrees": info.get("rotation_degrees", 0),
            "needs_upscale": info.get("needs_upscale", False),
            "short_side": info.get("short_side", 0),
        }

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        photos = list(await asyncio.gather(
            *[loop.run_in_executor(pool, _build_photo_entry, p) for p in paths]
        ))

    return {"photos": photos, "total": len(photos)}


@router.get("/photos/folder-counts")
async def folder_counts():
    """Return photo counts per lifecycle folder (to_process, analyzed, errored, processed)."""
    return count_photos_by_folder()


@router.get("/photos/{photo_id}/full")
async def get_full_photo(photo_id: str):
    """Serve the full image with EXIF rotation already applied."""
    from fastapi.responses import Response as RawResponse
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    info = get_image_info(path)
    if not info.get("needs_rotation"):
        media_type = MEDIA_TYPES.get(path.suffix.lower(), "image/jpeg")
        return FileResponse(str(path), media_type=media_type)

    img = Image.open(path)
    img = fix_orientation(img)
    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    img.close()
    return RawResponse(content=buf.getvalue(), media_type="image/jpeg")


@router.get("/photos/count")
async def photo_count():
    config.INPUT_DIR.mkdir(parents=True, exist_ok=True)
    return {"count": len(scan_image_paths(include_analyzed=True))}


ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".bmp"}


@router.post("/photos/upload")
async def upload_photos(files: list[UploadFile] = File(...)):
    """Upload multiple photos to the to_process/ folder."""
    config.INPUT_DIR.mkdir(parents=True, exist_ok=True)

    saved = []
    skipped = []

    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            skipped.append({"filename": f.filename, "reason": f"Unsupported format: {ext}"})
            continue

        dest = config.INPUT_DIR / f.filename
        counter = 2
        while dest.exists():
            dest = config.INPUT_DIR / f"{Path(f.filename).stem}_{counter}{ext}"
            counter += 1

        contents = await f.read()
        with open(dest, "wb") as out:
            out.write(contents)

        saved.append({"filename": dest.name, "size_kb": round(len(contents) / 1024, 1)})

    return {
        "uploaded": len(saved),
        "skipped": len(skipped),
        "files": saved,
        "skipped_files": skipped,
    }


@router.post("/photos/{photo_id}/rotate")
async def rotate_photo(photo_id: str):
    """Apply EXIF rotation fix and save to processed/ folder."""
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    info = get_image_info(path)
    if not info.get("needs_rotation"):
        raise HTTPException(status_code=400, detail="Photo does not need rotation")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")

        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = config.OUTPUT_DIR / f"{path.stem}_rotated.jpg"
        img.save(str(out_path), format="JPEG", quality=95)
        img.close()

        return {
            "status": "ok",
            "output_path": str(out_path),
            "filename": out_path.name,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rotation failed: {e}")


@router.post("/photos/{photo_id}/upscale")
async def upscale_photo(photo_id: str):
    """Upscale a photo using the Gemini image generation API."""
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        from google import genai
        from google.genai import types

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="No API key configured")

        client = genai.Client(api_key=api_key)

        img = Image.open(path)
        img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        image_bytes = buf.getvalue()
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

        image_data = None
        try:
            if response.candidates:
                parts = response.candidates[0].content.parts
                for part in parts:
                    if hasattr(part, "inline_data") and part.inline_data:
                        image_data = part.inline_data.data
                        break
        except (IndexError, AttributeError):
            pass

        if not image_data:
            raise HTTPException(status_code=500, detail="Upscale API returned no image")

        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = config.OUTPUT_DIR / f"{path.stem}_upscaled.jpg"
        with open(out_path, "wb") as f:
            f.write(image_data)

        return {
            "status": "ok",
            "output_path": str(out_path),
            "filename": out_path.name,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upscale failed: {e}")


@router.post("/photos/{photo_id}/save")
async def save_photo(photo_id: str):
    """Copy a photo to the processed/ folder as-is."""
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = config.OUTPUT_DIR / path.name

    counter = 1
    while out_path.exists():
        out_path = config.OUTPUT_DIR / f"{path.stem}_{counter}{path.suffix}"
        counter += 1

    shutil.copy2(str(path), str(out_path))
    return {
        "status": "ok",
        "output_path": str(out_path),
        "filename": out_path.name,
    }


class CropRequest(BaseModel):
    x: float
    y: float
    w: float
    h: float


@router.post("/photos/{photo_id}/crop")
async def crop_photo(photo_id: str, crop: CropRequest):
    """Crop a photo using percentage coordinates and save to processed/."""
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")
        img = crop_image(img, crop.x, crop.y, crop.w, crop.h)

        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = config.OUTPUT_DIR / f"{path.stem}_cropped.jpg"
        img.save(str(out_path), format="JPEG", quality=95)
        img.close()

        return {
            "status": "ok",
            "output_path": str(out_path),
            "filename": out_path.name,
            "width": img.size[0] if hasattr(img, 'size') else 0,
            "height": img.size[1] if hasattr(img, 'size') else 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Crop failed: {e}")


class ApplyEditsRequest(BaseModel):
    adjustments: dict


@router.post("/photos/{photo_id}/apply-edits")
async def apply_edits_to_photo(photo_id: str, req: ApplyEditsRequest):
    """Apply Lightroom-style slider adjustments to a photo using Pillow."""
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")
        img = apply_adjustments(img, req.adjustments)

        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = config.OUTPUT_DIR / f"{path.stem}_edited.jpg"
        img.save(str(out_path), format="JPEG", quality=95)
        w, h = img.size
        img.close()

        return {
            "status": "ok",
            "output_path": str(out_path),
            "filename": out_path.name,
            "width": w,
            "height": h,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edit failed: {e}")


class PreviewRequest(BaseModel):
    crop: Optional[dict] = None
    adjustments: Optional[dict] = None


@router.post("/photos/{photo_id}/preview")
async def preview_photo(photo_id: str, req: PreviewRequest):
    """Apply crop and/or adjustments and return a preview JPEG (not saved)."""
    from fastapi.responses import Response as RawResponse
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")

        if req.crop:
            img = crop_image(
                img,
                req.crop.get("x", 0),
                req.crop.get("y", 0),
                req.crop.get("w", 100),
                req.crop.get("h", 100),
            )

        w, h = img.size
        max_preview = 900
        if max(w, h) > max_preview:
            ratio = max_preview / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)

        if req.adjustments and len(req.adjustments) > 0:
            img = apply_adjustments(img, req.adjustments)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        img.close()
        return RawResponse(content=buf.getvalue(), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {e}")


@router.post("/photos/{photo_id}/preview-edits")
async def preview_edits(photo_id: str, req: ApplyEditsRequest):
    """Apply edits and return a preview JPEG (not saved to processed/)."""
    from fastapi.responses import Response as RawResponse
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")

        w, h = img.size
        max_preview = 800
        if max(w, h) > max_preview:
            ratio = max_preview / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)

        img = apply_adjustments(img, req.adjustments)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        img.close()
        return RawResponse(content=buf.getvalue(), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {e}")


@router.get("/photos/{photo_id}/slider-ranges")
async def get_slider_ranges(photo_id: str, style: Optional[str] = None):
    """
    Get slider ranges + preset info for a given style.
    Each preset has a slider_position (min/mid/max) that maps to where
    in the slider range it emulates.
    """
    from backend.analysis.library_loader import get_style_plans

    if not style:
        raise HTTPException(status_code=400, detail="style parameter required")

    plans = get_style_plans(style)
    if not plans or "lightroom" not in plans:
        raise HTTPException(status_code=404, detail=f"No plans for style: {style}")

    lr = plans["lightroom"]
    manual_sliders = lr.get("manual_sliders", {})
    parsed = parse_all_sliders(manual_sliders)

    presets_raw = lr.get("presets", {})
    presets_out = []
    for key in ["free_1", "free_2", "free_3", "paid_1", "paid_2"]:
        p = presets_raw.get(key)
        if not p:
            continue
        pos = p.get("slider_position", "mid")
        slider_values = {}
        for skey, sinfo in parsed.items():
            if sinfo.get("is_bool"):
                slider_values[skey] = sinfo.get("raw", False)
            elif pos == "min":
                slider_values[skey] = sinfo["min"]
            elif pos == "max":
                slider_values[skey] = sinfo["max"]
            else:
                slider_values[skey] = round((sinfo["min"] + sinfo["max"]) / 2, 2)

        presets_out.append({
            "key": key,
            "name": p.get("name", key),
            "price": p.get("price"),
            "notes": p.get("notes", ""),
            "justification": p.get("justification", ""),
            "is_free": key.startswith("free"),
            "slider_values": slider_values,
        })

    return {
        "style": style,
        "display_name": plans.get("display_name", style),
        "dating_impact": plans.get("dating_impact", ""),
        "sliders": parsed,
        "presets": presets_out,
    }


class ProcessPhotoRequest(BaseModel):
    rotate: bool = False
    crop: Optional[dict] = None
    adjustments: Optional[dict] = None
    upscale: bool = False
    upscale_mode: Optional[str] = "enhance"
    output_filename: Optional[str] = None
    rename_to_preset: bool = False
    run_id: Optional[str] = None


@router.post("/photos/{photo_id}/process")
async def process_photo(photo_id: str, req: ProcessPhotoRequest):
    """
    Apply all selected operations to a photo and save to processed/.

    Operations are applied in order: rotate -> crop -> adjustments -> upscale.
    The result is a single output file.
    """
    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")
        ops_applied = []

        if req.rotate:
            ops_applied.append("rotated")

        if req.crop:
            img = crop_image(
                img,
                req.crop.get("x", 0),
                req.crop.get("y", 0),
                req.crop.get("w", 100),
                req.crop.get("h", 100),
            )
            ops_applied.append("cropped")

        if req.adjustments and len(req.adjustments) > 0:
            img = apply_adjustments(img, req.adjustments)
            ops_applied.append("edited")

        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        preset_stem = None
        if req.rename_to_preset:
            preset_stem = _get_preset_filename(photo_id, req.run_id, path.name)

        def _make_out_path(base_name: str) -> Path:
            if req.output_filename:
                fn = req.output_filename
                if not fn.lower().endswith(".jpg"):
                    fn += ".jpg"
                return config.OUTPUT_DIR / fn
            if preset_stem:
                return _unique_path(config.OUTPUT_DIR, preset_stem)
            return config.OUTPUT_DIR / base_name

        if req.upscale:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=95)
            img.close()

            from google import genai
            from google.genai import types

            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise HTTPException(status_code=500, detail="No API key for upscale")

            upscale_mode = req.upscale_mode if req.upscale_mode in UPSCALE_PROMPTS else "enhance"
            prompt = UPSCALE_PROMPTS[upscale_mode]

            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=config.EDIT_MODEL,
                contents=[types.Content(
                    role="user",
                    parts=[
                        types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                        types.Part.from_text(text=prompt),
                    ],
                )],
                config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
            )

            image_data = None
            try:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, "inline_data") and part.inline_data:
                        image_data = part.inline_data.data
                        break
            except (IndexError, AttributeError):
                pass

            if not image_data:
                raise HTTPException(status_code=500, detail="Upscale API returned no image")

            suffix = "_".join(ops_applied + ["upscaled"])
            out_path = _make_out_path(f"{path.stem}_{suffix}.jpg")
            with open(out_path, "wb") as f:
                f.write(image_data)
            ops_applied.append("upscaled")
        else:
            suffix = "_".join(ops_applied) if ops_applied else "processed"
            out_path = _make_out_path(f"{path.stem}_{suffix}.jpg")
            img.save(str(out_path), format="JPEG", quality=95)
            img.close()

        return {
            "status": "ok",
            "output_path": str(out_path),
            "filename": out_path.name,
            "operations": ops_applied,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


class BatchProcessRequest(BaseModel):
    photo_ids: list[str]
    actions: list[str]


@router.post("/photos/batch-process")
async def batch_process(req: BatchProcessRequest):
    """Process multiple photos in batch: rotate, upscale, and/or save."""
    results = []
    errors = []

    for pid in req.photo_ids:
        path = _find_photo(pid)
        if not path or not path.exists():
            errors.append({"photo_id": pid, "error": "Photo not found"})
            continue

        info = get_image_info(path)
        photo_results = {"photo_id": pid, "filename": path.name, "actions": []}

        for action in req.actions:
            try:
                if action == "rotate" and info.get("needs_rotation"):
                    img = Image.open(path)
                    img = fix_orientation(img)
                    img = img.convert("RGB")
                    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                    out_path = config.OUTPUT_DIR / f"{path.stem}_rotated.jpg"
                    img.save(str(out_path), format="JPEG", quality=95)
                    img.close()
                    photo_results["actions"].append({
                        "action": "rotate",
                        "status": "ok",
                        "filename": out_path.name,
                    })

                elif action == "upscale" and info.get("needs_upscale"):
                    from google import genai
                    from google.genai import types

                    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
                    if not api_key:
                        photo_results["actions"].append({
                            "action": "upscale",
                            "status": "error",
                            "error": "No API key",
                        })
                        continue

                    client = genai.Client(api_key=api_key)
                    img = Image.open(path).convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=95)
                    img.close()

                    response = client.models.generate_content(
                        model=config.EDIT_MODEL,
                        contents=[types.Content(
                            role="user",
                            parts=[
                                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                                types.Part.from_text(
                                    text="Upscale and enhance this photo to higher resolution. "
                                    "Preserve all details, colors, and composition exactly."
                                ),
                            ],
                        )],
                        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
                    )

                    image_data = None
                    try:
                        for part in response.candidates[0].content.parts:
                            if hasattr(part, "inline_data") and part.inline_data:
                                image_data = part.inline_data.data
                                break
                    except (IndexError, AttributeError):
                        pass

                    if image_data:
                        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                        out_path = config.OUTPUT_DIR / f"{path.stem}_upscaled.jpg"
                        with open(out_path, "wb") as f:
                            f.write(image_data)
                        photo_results["actions"].append({
                            "action": "upscale",
                            "status": "ok",
                            "filename": out_path.name,
                        })
                    else:
                        photo_results["actions"].append({
                            "action": "upscale",
                            "status": "error",
                            "error": "API returned no image",
                        })

                elif action == "save":
                    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                    out_path = config.OUTPUT_DIR / path.name
                    counter = 1
                    while out_path.exists():
                        out_path = config.OUTPUT_DIR / f"{path.stem}_{counter}{path.suffix}"
                        counter += 1
                    shutil.copy2(str(path), str(out_path))
                    photo_results["actions"].append({
                        "action": "save",
                        "status": "ok",
                        "filename": out_path.name,
                    })

            except Exception as e:
                photo_results["actions"].append({
                    "action": action,
                    "status": "error",
                    "error": str(e),
                })

        results.append(photo_results)

    return {"results": results, "errors": errors}


UPSCALE_PROMPTS = {
    "clarity": (
        "Increase the resolution and sharpness of this photo. "
        "Focus only on improving pixel clarity, reducing blur and noise, "
        "and adding fine detail. Do NOT change the lighting, colors, contrast, "
        "mood, or style in any way. The result should look identical to the "
        "original but with higher resolution and sharper detail."
    ),
    "enhance": (
        "Enhance this portrait photo to professional quality. Preserve 100% of the original "
        "identity — face structure, expression, pose, clothing, and background must remain "
        "unchanged. Recover fine detail: sharp facial features, natural skin texture with "
        "visible pores, realistic hair strands, and clean edges. Apply balanced cinematic "
        "lighting with improved dynamic range — lift shadows slightly, recover highlights, "
        "without relighting or reshaping. Remove compression artifacts and digital noise. "
        "Apply controlled sharpening. Do NOT smooth skin artificially, do NOT alter facial "
        "anatomy, do NOT change colors dramatically. Output should read as a true-to-life "
        "photorealistic enhancement — the same photo, only clearer, sharper, and higher "
        "resolution."
    ),
}


class UpscalePreviewRequest(BaseModel):
    crop: Optional[dict] = None
    adjustments: Optional[dict] = None
    mode: Optional[str] = "enhance"


@router.post("/photos/{photo_id}/upscale-preview")
async def upscale_preview(photo_id: str, req: UpscalePreviewRequest = None):
    """
    Upscale a photo (with optional crop/adjustments applied first) and return
    the result as JPEG bytes for preview. Does NOT save to disk.

    mode: "clarity" (resolution only) or "enhance" (full AI enhancement)
    """
    from fastapi.responses import Response as RawResponse

    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    mode = (req.mode if req and req.mode else "enhance")
    if mode not in UPSCALE_PROMPTS:
        mode = "enhance"
    prompt = UPSCALE_PROMPTS[mode]

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")

        if req and req.crop:
            img = crop_image(
                img,
                req.crop.get("x", 0),
                req.crop.get("y", 0),
                req.crop.get("w", 100),
                req.crop.get("h", 100),
            )

        if req and req.adjustments and len(req.adjustments) > 0:
            img = apply_adjustments(img, req.adjustments)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        img.close()

        from google import genai
        from google.genai import types

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="No API key configured")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=config.EDIT_MODEL,
            contents=[types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                    types.Part.from_text(text=prompt),
                ],
            )],
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
        )

        if not response.candidates:
            block_reason = getattr(response, 'prompt_feedback', None)
            detail = f"Gemini returned no candidates. Model: {config.EDIT_MODEL}, mode: {mode}"
            if block_reason:
                detail += f", feedback: {block_reason}"
            raise HTTPException(status_code=500, detail=detail)

        candidate = response.candidates[0]
        finish_reason = getattr(candidate, 'finish_reason', None)

        image_data = None
        text_parts = []
        try:
            for part in candidate.content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_data = part.inline_data.data
                elif hasattr(part, "text") and part.text:
                    text_parts.append(part.text)
        except (IndexError, AttributeError):
            pass

        if not image_data:
            detail = f"Gemini returned no image. Model: {config.EDIT_MODEL}, mode: {mode}, finish_reason: {finish_reason}"
            if text_parts:
                detail += f", text response: {' '.join(text_parts)[:300]}"
            raise HTTPException(status_code=500, detail=detail)

        return RawResponse(content=image_data, media_type="image/jpeg")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Upscale preview failed ({config.EDIT_MODEL}, mode={mode}): {e}\n{tb[-500:]}"
        )


@router.post("/photos/{photo_id}/blur-preview")
async def blur_preview(photo_id: str):
    """
    Generate a Gemini AI background-blur preview for the Blur Background > Subtle preset.
    Returns JPEG bytes — does NOT save to disk.
    """
    from fastapi.responses import Response as RawResponse

    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    try:
        img = Image.open(path)
        img = fix_orientation(img)
        img = img.convert("RGB")

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        img.close()

        from google import genai
        from google.genai import types

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="No API key configured")

        blur_prompt = (
            "Apply a professional background blur (bokeh/portrait mode) to this photo. "
            "Keep the main subject (person) perfectly sharp and in focus. "
            "Blur only the background behind the subject using a natural shallow depth-of-field effect. "
            "Do not alter the subject's appearance, colors, or the overall composition. "
            "The result should look like it was taken with a professional camera in portrait mode."
        )

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=config.EDIT_MODEL,
            contents=[types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                    types.Part.from_text(text=blur_prompt),
                ],
            )],
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
        )

        image_data = None
        try:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_data = part.inline_data.data
                    break
        except (IndexError, AttributeError):
            pass

        if not image_data:
            raise HTTPException(status_code=500, detail="Gemini returned no image for blur preview")

        return RawResponse(content=image_data, media_type="image/jpeg")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Blur preview failed: {e}")


@router.get("/photos/{photo_id}/crop-recommendation")
async def get_crop_recommendation_endpoint(photo_id: str, run_id: str = None):
    """Return 2-3 crop options for a photo based on its analysis metadata."""
    from backend.analysis.crop_matcher import get_crop_options

    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    info = get_image_info(path)
    metadata = {}
    if run_id:
        run_result = _find_run_result(run_id, photo_id, path.name)
        if run_result:
            metadata = run_result.get("metadata", {})

    options = get_crop_options(
        metadata,
        info.get("width", 0),
        info.get("height", 0),
        max_options=3,
    )
    return {
        "photo_id": photo_id,
        "crop_options": options,
    }


@router.get("/photos/{photo_id}/preset-recommendation")
async def get_preset_recommendation(photo_id: str, run_id: str = None):
    """
    Return the top 3 preset recommendations for a photo based on its analysis metadata.
    """
    from backend.analysis.preset_matcher import get_recommendations, get_danger_zones

    path = _find_photo(photo_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    metadata = None
    if run_id:
        run_result = _find_run_result(run_id, photo_id, path.name)
        if run_result:
            metadata = run_result.get("metadata")

    recs = get_recommendations(metadata or {}, max_results=3)
    dangers = get_danger_zones()

    return {
        "photo_id": photo_id,
        "recommendation": recs[0] if recs else None,
        "recommendations": recs,
        "danger_zones": dangers,
    }


@router.get("/processed")
async def list_processed():
    """List all photos in the processed/ folder."""
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    files = [
        p for p in sorted(config.OUTPUT_DIR.iterdir())
        if p.is_file() and p.suffix.lower() in exts
    ]
    return {
        "files": [{"filename": f.name, "size_kb": round(f.stat().st_size / 1024, 1)} for f in files],
        "total": len(files),
        "folder": str(config.OUTPUT_DIR),
    }


class BatchRenameRequest(BaseModel):
    photo_ids: list[str]
    run_id: str


@router.post("/photos/batch-rename")
async def batch_rename(req: BatchRenameRequest):
    """Copy photos to processed/ renamed to their top recommended preset name."""
    results = []
    errors = []

    for pid in req.photo_ids:
        path = _find_photo(pid)
        if not path or not path.exists():
            errors.append({"photo_id": pid, "error": "Photo not found"})
            continue

        preset_stem = _get_preset_filename(pid, req.run_id, path.name)
        if not preset_stem:
            errors.append({"photo_id": pid, "error": "No preset recommendation found"})
            continue

        try:
            img = Image.open(path)
            img = fix_orientation(img)
            img = img.convert("RGB")

            config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            out_path = _unique_path(config.OUTPUT_DIR, preset_stem)
            img.save(str(out_path), format="JPEG", quality=95)
            img.close()

            results.append({
                "photo_id": pid,
                "original_filename": path.name,
                "output_filename": out_path.name,
                "preset_name": preset_stem.replace("_", " "),
                "status": "ok",
            })
        except Exception as e:
            errors.append({"photo_id": pid, "error": str(e)})

    return {
        "results": results,
        "errors": errors,
        "total_renamed": len(results),
        "total_errors": len(errors),
    }


class BatchEnhanceRequest(BaseModel):
    photo_ids: list[str]
    run_id: Optional[str] = None
    crop: bool = False
    upscale: bool = False
    upscale_mode: str = "enhance"
    save: bool = False
    rename_to_preset: bool = False


@router.post("/photos/batch-enhance")
async def batch_enhance(req: BatchEnhanceRequest):
    """
    Full-pipeline batch processing: for each photo, apply its best recommended
    crop and/or AI upscale, then save to processed/.
    """
    import json
    from backend.analysis.crop_matcher import get_crop_options

    metadata_map = {}
    if req.run_id:
        run_path = config.RUNS_DIR / f"{req.run_id}.json"
        if run_path.exists():
            with open(run_path, "r") as f:
                run_data = json.load(f)
            for r in run_data.get("results", []):
                metadata_map[r.get("image_id")] = r.get("metadata", {})

    upscale_mode = req.upscale_mode if req.upscale_mode in UPSCALE_PROMPTS else "enhance"
    prompt = UPSCALE_PROMPTS[upscale_mode]

    results = []
    errors = []

    for pid in req.photo_ids:
        path = _find_photo(pid)
        if not path or not path.exists():
            errors.append({"photo_id": pid, "error": "Photo not found"})
            continue

        try:
            img = Image.open(path)
            img = fix_orientation(img)
            img = img.convert("RGB")
            ops = []

            if req.crop:
                metadata = metadata_map.get(pid, {})
                crop_opts = get_crop_options(
                    metadata,
                    img_width=img.width,
                    img_height=img.height,
                    max_options=1,
                )
                if crop_opts:
                    c = crop_opts[0]["crop"]
                    img = crop_image(img, c["x"], c["y"], c["w"], c["h"])
                    ops.append("cropped")

            config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

            preset_stem = None
            if req.rename_to_preset:
                preset_stem = _get_preset_filename(pid, req.run_id, path.name)

            def _batch_out_path(fallback_name: str) -> Path:
                if preset_stem:
                    return _unique_path(config.OUTPUT_DIR, preset_stem)
                return config.OUTPUT_DIR / fallback_name

            if req.upscale:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=95)
                img.close()

                from google import genai
                from google.genai import types

                api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
                if not api_key:
                    errors.append({"photo_id": pid, "error": "No API key"})
                    continue

                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=config.EDIT_MODEL,
                    contents=[types.Content(
                        role="user",
                        parts=[
                            types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
                            types.Part.from_text(text=prompt),
                        ],
                    )],
                    config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
                )

                image_data = None
                try:
                    for part in response.candidates[0].content.parts:
                        if hasattr(part, "inline_data") and part.inline_data:
                            image_data = part.inline_data.data
                            break
                except (IndexError, AttributeError):
                    pass

                if not image_data:
                    errors.append({"photo_id": pid, "error": "Upscale API returned no image"})
                    continue

                ops.append("enhanced")
                suffix = "_".join(ops)
                out_path = _batch_out_path(f"{path.stem}_{suffix}.jpg")
                with open(out_path, "wb") as f:
                    f.write(image_data)
            elif req.save or req.crop:
                suffix = "_".join(ops) if ops else "processed"
                out_path = _batch_out_path(f"{path.stem}_{suffix}.jpg")
                img.save(str(out_path), format="JPEG", quality=95)
                img.close()
                if req.save:
                    ops.append("saved")
            else:
                img.close()
                out_path = None

            results.append({
                "photo_id": pid,
                "filename": path.name,
                "output": out_path.name if out_path else None,
                "operations": ops,
                "status": "ok",
            })

        except Exception as e:
            errors.append({"photo_id": pid, "error": str(e)})

    return {
        "results": results,
        "errors": errors,
        "total_processed": len(results),
        "total_errors": len(errors),
    }
