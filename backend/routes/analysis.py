"""
Analysis endpoints — run Gemini analysis and style selection.

These endpoints handle:
- Analyzing single photos or batches
- Retrieving past analysis results (runs)
- Listing past runs
- Retrying failed photos from a previous run
"""
import asyncio
import io
import json
import hashlib
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend import config
from backend.gemini.client import analyze_photo, estimate_cost
from backend.analysis.selector import select_styles_from_dict
from backend.analysis.preset_matcher import get_recommendation
from backend.images.scanner import scan_image_paths, scan_all_image_paths

router = APIRouter(tags=["analysis"])

# Tracks in-progress batch runs: run_id -> progress dict
_active_runs: dict[str, dict] = {}


def _photo_id(path: Path) -> str:
    return hashlib.md5(str(path.resolve()).encode()).hexdigest()[:12]


def _find_photo_by_id(photo_id: str) -> Path | None:
    for path in scan_all_image_paths():
        if _photo_id(path) == photo_id:
            return path
    return None


def _move_to_folder(path: Path, dest_dir: Path) -> Path:
    """Move a file to dest_dir, creating it if needed. Returns new path."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    if dest.exists() and dest.resolve() != path.resolve():
        stem, suffix = path.stem, path.suffix
        counter = 2
        while dest.exists():
            dest = dest_dir / f"{stem}_{counter}{suffix}"
            counter += 1
    shutil.move(str(path), str(dest))
    return dest


def _sanitize_filename(name: str) -> str:
    """Convert a filename to profile_photo_style_name format."""
    stem = Path(name).stem.lower()
    stem = "".join(c if c.isalnum() or c == "_" else "_" for c in stem)
    stem = "_".join(part for part in stem.split("_") if part)
    return stem


@router.post("/analyze/single")
async def analyze_single(
    photo_id: str,
    model: Optional[str] = Query(default=None, description="Gemini model to use"),
):
    """Analyze a single photo: extract metadata via Gemini, then select styles."""
    path = _find_photo_by_id(photo_id)
    if not path:
        raise HTTPException(status_code=404, detail="Photo not found")

    result = await analyze_photo(path, model_name=model)

    if result["error"]:
        raise HTTPException(status_code=500, detail=result["error"])

    metadata = result["metadata"]
    style_result = select_styles_from_dict(metadata)
    preset_rec = get_recommendation(metadata)

    output_name = f"profile_photo_{_sanitize_filename(path.name)}"

    return {
        "image_id": photo_id,
        "filename": path.name,
        "output_name": output_name,
        **style_result,
        "preset_recommendation": preset_rec,
        "token_usage": result["token_usage"],
    }


@router.post("/analyze/batch")
async def analyze_batch(
    model: Optional[str] = Query(default=None, description="Gemini model to use"),
    limit: Optional[int] = Query(default=None, description="Max photos to analyze"),
    all_folders: Optional[bool] = Query(default=False, description="Include analyzed/ and errored/ folders too"),
):
    """
    Analyze all photos in to_process/ (or up to limit).

    After each photo finishes, it is moved to analyzed/ on success or errored/ on failure.
    Creates a run file in data/runs/ with all results.
    Progress is written incrementally so /analyze/batch/progress can be polled.
    Returns the run_id so the frontend can navigate to results.
    """
    if all_folders:
        paths = scan_all_image_paths()
    else:
        paths = scan_image_paths()

    if not paths:
        raise HTTPException(status_code=400, detail="No photos found in to_process/")

    if limit and limit > 0:
        paths = paths[:limit]

    model_name = model or config.DEFAULT_ANALYSIS_MODEL
    semaphore = asyncio.Semaphore(config.ANALYSIS_CONCURRENCY)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    config.RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_path = config.RUNS_DIR / f"{ts}.json"

    results = []
    errors = []
    log: list[str] = []
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    completed = 0
    total = len(paths)

    progress = {
        "run_id": ts,
        "status": "running",
        "total": total,
        "completed": 0,
        "errors": 0,
        "log": log,
    }
    _active_runs[ts] = progress

    def _flush_progress():
        progress["completed"] = completed
        progress["errors"] = len(errors)

    async def _analyze_and_track(path: Path):
        nonlocal completed
        photo_id = _photo_id(path)
        try:
            result, usage = await _analyze_one(path, model_name, semaphore)
            for k in total_usage:
                total_usage[k] += usage.get(k, 0)
            if result.get("error"):
                errors.append({"image_id": photo_id, "filename": path.name, "error": result["error"]})
                log.append(f"✗ {path.name} — {result['error']}")
                try:
                    _move_to_folder(path, config.ERRORED_DIR)
                except Exception:
                    pass
            else:
                metadata = result["metadata"]
                style_result = select_styles_from_dict(metadata)
                preset_rec = get_recommendation(metadata)
                output_name = f"profile_photo_{_sanitize_filename(path.name)}"
                results.append({
                    "image_id": photo_id,
                    "filename": path.name,
                    "output_name": output_name,
                    **style_result,
                    "preset_recommendation": preset_rec,
                })
                top_style = style_result.get("styles", [{}])[0].get("name", "?") if style_result.get("styles") else "?"
                log.append(f"✓ {path.name} — {top_style}")
                try:
                    _move_to_folder(path, config.ANALYZED_DIR)
                except Exception:
                    pass
        except Exception as exc:
            errors.append({"image_id": photo_id, "filename": path.name, "error": str(exc)})
            log.append(f"✗ {path.name} — {exc}")
            try:
                _move_to_folder(path, config.ERRORED_DIR)
            except Exception:
                pass
        finally:
            completed += 1
            _flush_progress()

    try:
        await asyncio.gather(*[_analyze_and_track(p) for p in paths])
    finally:
        progress["status"] = "done"
        _active_runs.pop(ts, None)

    run_data = {
        "run_id": ts,
        "model": model_name,
        "total_photos": total,
        "total_analyzed": len(results),
        "total_errors": len(errors),
        "token_usage": total_usage,
        "estimated_cost_usd": estimate_cost(model_name, total)["estimated_cost_usd"],
        "results": results,
        "errors": errors,
    }

    with open(run_path, "w", encoding="utf-8") as f:
        json.dump(run_data, f, indent=2)

    return run_data


@router.post("/analyze/retry/{run_id}")
async def retry_failed(run_id: str):
    """
    Re-analyze only the failed photos from a previous run.

    Moves photos from errored/ back to to_process/, re-runs Gemini on them,
    and merges new successes into the existing run JSON.
    Returns the updated run data.
    """
    run_path = config.RUNS_DIR / f"{run_id}.json"
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")

    with open(run_path, encoding="utf-8") as f:
        run_data = json.load(f)

    existing_errors = run_data.get("errors", [])
    if not existing_errors:
        return run_data

    model_name = run_data.get("model", config.DEFAULT_ANALYSIS_MODEL)
    semaphore = asyncio.Semaphore(config.ANALYSIS_CONCURRENCY)

    # Find the errored files on disk
    failed_filenames = {e["filename"] for e in existing_errors}
    retry_paths: list[Path] = []
    for path in scan_all_image_paths():
        if path.name in failed_filenames:
            # Move back to to_process/ if in errored/
            if path.parent.resolve() == config.ERRORED_DIR.resolve():
                try:
                    path = _move_to_folder(path, config.INPUT_DIR)
                except Exception:
                    pass
            retry_paths.append(path)

    if not retry_paths:
        raise HTTPException(
            status_code=404,
            detail="Could not find the failed photo files on disk (they may have been moved or deleted)"
        )

    new_results: list[dict] = []
    still_failed: list[dict] = []

    async def _retry_one(path: Path):
        photo_id = _photo_id(path)
        try:
            result, _ = await _analyze_one(path, model_name, semaphore)
            if result.get("error"):
                still_failed.append({"image_id": photo_id, "filename": path.name, "error": result["error"]})
                try:
                    _move_to_folder(path, config.ERRORED_DIR)
                except Exception:
                    pass
            else:
                metadata = result["metadata"]
                style_result = select_styles_from_dict(metadata)
                preset_rec = get_recommendation(metadata)
                output_name = f"profile_photo_{_sanitize_filename(path.name)}"
                new_results.append({
                    "image_id": photo_id,
                    "filename": path.name,
                    "output_name": output_name,
                    **style_result,
                    "preset_recommendation": preset_rec,
                })
                try:
                    _move_to_folder(path, config.ANALYZED_DIR)
                except Exception:
                    pass
        except Exception as exc:
            still_failed.append({"image_id": photo_id, "filename": path.name, "error": str(exc)})
            try:
                _move_to_folder(path, config.ERRORED_DIR)
            except Exception:
                pass

    await asyncio.gather(*[_retry_one(p) for p in retry_paths])

    # Merge into existing run: add new successes, keep only still-failed errors
    retried_filenames = {p.name for p in retry_paths}
    merged_results = run_data.get("results", []) + new_results
    merged_errors = [e for e in existing_errors if e["filename"] not in retried_filenames] + still_failed

    run_data["results"] = merged_results
    run_data["errors"] = merged_errors
    run_data["total_analyzed"] = len(merged_results)
    run_data["total_errors"] = len(merged_errors)

    with open(run_path, "w", encoding="utf-8") as f:
        json.dump(run_data, f, indent=2)

    return run_data


@router.get("/analyze/batch/progress")
async def get_batch_progress():
    """
    Returns the progress of the currently running batch analysis.
    Poll this while /analyze/batch is in flight.
    """
    if not _active_runs:
        return {"status": "idle", "total": 0, "completed": 0, "errors": 0, "log": []}
    # Return the most recently started run
    run_id = next(reversed(_active_runs))
    return _active_runs[run_id]


async def _analyze_one(
    path: Path,
    model_name: str,
    semaphore: asyncio.Semaphore,
) -> tuple[dict, dict]:
    result = await analyze_photo(path, model_name=model_name, semaphore=semaphore)
    return result, result.get("token_usage", {})


@router.get("/runs")
async def list_runs():
    """List all past analysis runs."""
    config.RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_files = sorted(
        config.RUNS_DIR.glob("*.json"),
        key=lambda p: p.name,
        reverse=True,
    )

    runs = []
    for f in run_files:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            runs.append({
                "run_id": data.get("run_id", f.stem),
                "model": data.get("model", "unknown"),
                "total_photos": data.get("total_photos", 0),
                "total_analyzed": data.get("total_analyzed", 0),
                "total_errors": data.get("total_errors", 0),
                "estimated_cost_usd": data.get("estimated_cost_usd", 0),
            })
        except (json.JSONDecodeError, OSError):
            continue

    return {"runs": runs}


class ArchiveRequest(BaseModel):
    photo_ids: list[str]


@router.post("/photos/archive")
async def archive_photos(req: ArchiveRequest):
    """
    Move photos to data/archived/ — removes them from the active pipeline
    without deleting them. Works on photos in any folder.
    """
    config.ARCHIVED_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    errors = []

    for photo_id in req.photo_ids:
        path = _find_photo_by_id(photo_id)
        if not path or not path.exists():
            errors.append({"photo_id": photo_id, "error": "Photo not found"})
            continue
        if path.parent.resolve() == config.ARCHIVED_DIR.resolve():
            results.append({"photo_id": photo_id, "filename": path.name, "status": "already_archived"})
            continue
        try:
            new_path = _move_to_folder(path, config.ARCHIVED_DIR)
            results.append({"photo_id": photo_id, "filename": new_path.name, "status": "archived"})
        except Exception as e:
            errors.append({"photo_id": photo_id, "error": str(e)})

    return {
        "archived": len([r for r in results if r["status"] == "archived"]),
        "errors": len(errors),
        "results": results,
        "error_details": errors,
    }


@router.post("/photos/unarchive")
async def unarchive_photos(req: ArchiveRequest):
    """Move photos from archived/ back to analyzed/ so they re-enter the pipeline."""
    config.ANALYZED_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    errors = []

    for photo_id in req.photo_ids:
        path = _find_photo_by_id(photo_id)
        if not path or not path.exists():
            errors.append({"photo_id": photo_id, "error": "Photo not found"})
            continue
        try:
            new_path = _move_to_folder(path, config.ANALYZED_DIR)
            results.append({"photo_id": photo_id, "filename": new_path.name, "status": "unarchived"})
        except Exception as e:
            errors.append({"photo_id": photo_id, "error": str(e)})

    return {
        "unarchived": len([r for r in results if r["status"] == "unarchived"]),
        "errors": len(errors),
        "results": results,
        "error_details": errors,
    }


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Get the full results of a specific run."""
    run_path = config.RUNS_DIR / f"{run_id}.json"
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")

    with open(run_path, encoding="utf-8") as f:
        return json.load(f)


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str):
    """Delete a run's JSON file. Does NOT delete the photos themselves."""
    run_path = config.RUNS_DIR / f"{run_id}.json"
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    run_path.unlink()
    return {"deleted": run_id}


@router.get("/runs/merged/all")
async def get_merged_run():
    """
    Return a synthetic merged run combining all run JSONs.
    Deduplicates by filename — keeps the most recent result for each photo.
    """
    config.RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_files = sorted(
        config.RUNS_DIR.glob("*.json"),
        key=lambda p: p.name,
        reverse=True,
    )

    seen_filenames: set[str] = set()
    merged_results: list[dict] = []
    merged_errors: list[dict] = []
    total_cost = 0.0

    for rf in run_files:
        try:
            with open(rf, encoding="utf-8") as f:
                data = json.load(f)
            for r in data.get("results", []):
                fname = r.get("filename", "")
                if fname not in seen_filenames:
                    seen_filenames.add(fname)
                    merged_results.append(r)
            for e in data.get("errors", []):
                fname = e.get("filename", "")
                if fname not in seen_filenames:
                    merged_errors.append(e)
            total_cost += data.get("estimated_cost_usd", 0) or 0
        except Exception:
            continue

    return {
        "run_id": "all",
        "model": "merged",
        "total_photos": len(merged_results) + len(merged_errors),
        "total_analyzed": len(merged_results),
        "total_errors": len(merged_errors),
        "estimated_cost_usd": round(total_cost, 6),
        "results": merged_results,
        "errors": merged_errors,
    }


@router.get("/runs/{run_id}/download")
async def download_run_photos(
    run_id: str,
    photo_ids: Optional[str] = Query(default=None, description="Comma-separated photo IDs to include (omit for all)"),
    folder: Optional[str] = Query(default="analyzed", description="Which folder to pull from: analyzed, processed, or all"),
):
    """
    Download a ZIP of all photos from a run (or a selected subset).

    - photo_ids: optional comma-separated list of image_id values to include
    - folder: 'analyzed' (default), 'processed', or 'all'
    """
    import concurrent.futures
    from fastapi.responses import FileResponse

    run_path = config.RUNS_DIR / f"{run_id}.json"
    if not run_path.exists():
        raise HTTPException(status_code=404, detail="Run not found")

    with open(run_path, encoding="utf-8") as f:
        run_data = json.load(f)

    results = run_data.get("results", [])

    # Filter to requested photo_ids if provided
    if photo_ids:
        requested = set(photo_ids.split(","))
        results = [r for r in results if r.get("image_id") in requested]

    if not results:
        raise HTTPException(status_code=404, detail="No photos found for download")

    # Build filename → path lookup across relevant folders
    search_dirs: list[Path] = []
    if folder == "processed":
        search_dirs = [config.OUTPUT_DIR]
    elif folder == "all":
        search_dirs = [config.INPUT_DIR, config.ANALYZED_DIR, config.OUTPUT_DIR, config.ERRORED_DIR]
    else:
        search_dirs = [config.ANALYZED_DIR, config.INPUT_DIR]

    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    available: dict[str, Path] = {}
    for d in search_dirs:
        if not d.exists():
            continue
        for p in d.rglob("*"):
            if p.is_file() and p.suffix.lower() in exts:
                available[p.name] = p

    # Collect files to zip
    to_zip: list[tuple[str, Path]] = []
    for r in results:
        fname = r.get("filename", "")
        if fname in available:
            to_zip.append((fname, available[fname]))

    if not to_zip:
        raise HTTPException(status_code=404, detail="No photo files found on disk for this run")

    # Build ZIP in a thread so we don't block the async event loop
    def _build_zip() -> str:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        with zipfile.ZipFile(tmp, mode="w", compression=zipfile.ZIP_STORED) as zf:
            for arcname, path in to_zip:
                zf.write(str(path), arcname=arcname)
        tmp.close()
        return tmp.name

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        zip_path = await loop.run_in_executor(pool, _build_zip)

    zip_filename = f"run_{run_id}_photos.zip"

    # Use BackgroundTask to delete the temp file after it's been sent
    from starlette.background import BackgroundTask
    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=zip_filename,
        background=BackgroundTask(os.unlink, zip_path),
    )
