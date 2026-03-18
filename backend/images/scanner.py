"""
Scan folders for image files.

Finds all supported image files in a directory, deduplicates them,
and returns sorted paths.
"""
import hashlib
from pathlib import Path

from backend import config


def scan_image_paths(
    input_dir: Path | None = None,
    include_analyzed: bool = False,
    include_errored: bool = False,
    include_archived: bool = False,
) -> list[Path]:
    """
    Find all supported image files in the input directory (and optionally analyzed/errored/archived).

    By default only scans to_process/. Pass include_analyzed=True or include_errored=True
    to also include those folders (used when looking up photos by ID for serving/editing).

    Returns deduplicated, sorted list of image paths.
    """
    folders: list[Path]
    if input_dir is not None:
        folders = [input_dir]
    else:
        folders = [config.INPUT_DIR]
        if include_analyzed:
            folders.append(config.ANALYZED_DIR)
        if include_errored:
            folders.append(config.ERRORED_DIR)
        if include_archived:
            folders.append(config.ARCHIVED_DIR)

    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    all_paths: list[Path] = []
    for folder in folders:
        if not folder.exists():
            continue
        all_paths.extend(
            p for p in folder.rglob("*")
            if p.is_file() and p.suffix.lower() in exts
        )

    seen: set[Path] = set()
    unique: list[Path] = []
    for p in sorted(all_paths, key=lambda x: str(x).lower()):
        resolved = p.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(p)

    return unique


def scan_all_image_paths() -> list[Path]:
    """Scan to_process/, analyzed/, errored/, and archived/ — used for photo lookup by ID."""
    return scan_image_paths(include_analyzed=True, include_errored=True, include_archived=True)


def count_photos_by_folder() -> dict:
    """Return photo counts for the active pipeline folders (to_process, analyzed, errored).

    processed/ is an export destination and is intentionally excluded — it accumulates
    files from many runs and its count is not meaningful as a pipeline stage.
    """
    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}

    def _count(folder: Path) -> int:
        if not folder.exists():
            return 0
        return sum(1 for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in exts)

    counts = {
        "to_process": _count(config.INPUT_DIR),
        "analyzed": _count(config.ANALYZED_DIR),
        "errored": _count(config.ERRORED_DIR),
        "archived": _count(config.ARCHIVED_DIR),
    }

    # Surface the most recent run's summary so the frontend can show it
    last_run = None
    if config.RUNS_DIR.exists():
        run_files = sorted(config.RUNS_DIR.glob("*.json"), key=lambda p: p.name, reverse=True)
        for rf in run_files:
            try:
                import json as _json
                with open(rf, encoding="utf-8") as f:
                    d = _json.load(f)
                last_run = {
                    "run_id": d.get("run_id", rf.stem),
                    "total_photos": d.get("total_photos", 0),
                    "total_analyzed": d.get("total_analyzed", 0),
                    "total_errors": d.get("total_errors", 0),
                }
                break
            except Exception:
                continue

    counts["last_run"] = last_run
    return counts


def file_hash(path: Path) -> str:
    """SHA-256 hash of a file's contents. Used to detect duplicates."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_exif_orientation(img) -> int:
    """Read EXIF orientation tag. Returns 1 (normal) if not found."""
    try:
        from PIL.ExifTags import Base as ExifBase
        exif = img.getexif()
        return exif.get(ExifBase.Orientation, 1)
    except Exception:
        return 1


def _orientation_to_rotation(orientation: int) -> int:
    """Map EXIF orientation value to degrees of rotation needed."""
    return {3: 180, 6: 270, 8: 90}.get(orientation, 0)


def get_image_info(path: Path) -> dict:
    """Basic info about an image file including rotation and upscale needs."""
    try:
        from PIL import Image
        from backend import config
        img = Image.open(path)
        try:
            w, h = img.size
            orientation = _get_exif_orientation(img)
            rotation_needed = _orientation_to_rotation(orientation)
            short_side = min(w, h)
            needs_upscale = short_side < config.MIN_RESOLUTION_SHORT_SIDE

            return {
                "filename": path.name,
                "path": str(path),
                "width": w,
                "height": h,
                "size_kb": round(path.stat().st_size / 1024, 1),
                "format": img.format or path.suffix.upper().strip("."),
                "needs_rotation": rotation_needed != 0,
                "rotation_degrees": rotation_needed,
                "needs_upscale": needs_upscale,
                "short_side": short_side,
            }
        finally:
            img.close()
    except Exception as e:
        return {
            "filename": path.name,
            "path": str(path),
            "width": 0,
            "height": 0,
            "size_kb": round(path.stat().st_size / 1024, 1) if path.exists() else 0,
            "format": "unknown",
            "needs_rotation": False,
            "rotation_degrees": 0,
            "needs_upscale": False,
            "short_side": 0,
            "error": str(e),
        }
