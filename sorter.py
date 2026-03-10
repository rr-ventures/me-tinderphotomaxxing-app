"""
ImageStudio — File sorter (optional).
Moves approved images into bucket folders under processed/.
Not currently used by the main app — kept for potential future use.
"""
import json
import re
import shutil
from datetime import datetime
from pathlib import Path


DEFAULT_BUCKETS = ["keep", "maybe", "skip", "unknown"]


def generate_filename(row: dict, suffix: str) -> str:
    description = row.get("description")
    vendor = row.get("vendor")
    total = row.get("total")
    date = row.get("date")
    category = (row.get("category") or "").lower()

    if vendor:
        words = re.findall(r"[a-zA-Z0-9]+", vendor)
        name = "-".join(words[:2])
    elif description:
        words = re.findall(r"[a-zA-Z0-9]+", description)
        name = "-".join(words[:3])
    else:
        name = category if category and category != "unknown" else "image"

    name = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not name:
        name = "file"

    parts = [name]
    if date:
        parts.append(date)

    is_receipt = category in ("receipt", "invoice")
    if is_receipt and total is not None and str(total).strip():
        price = re.sub(r"[^0-9.]", "", str(total))
        if price:
            parts.append(price)

    return "-".join(parts) + suffix


def execute(
    manifest_path_or_data: str | Path | dict,
    output_dir: str | Path,
    runs_dir: str | Path,
    buckets: list[str] | None = None,
) -> dict:
    output_dir = Path(output_dir).resolve()
    runs_dir = Path(runs_dir).resolve()
    buckets = buckets or DEFAULT_BUCKETS

    if isinstance(manifest_path_or_data, dict):
        manifest = manifest_path_or_data
        run_id = manifest.get("run_id", "unknown")
    else:
        path = Path(manifest_path_or_data).resolve()
        with open(path, encoding="utf-8") as f:
            manifest = json.load(f)
        run_id = manifest.get("run_id", path.stem)

    images = manifest.get("images", [])
    approved = [row for row in images if row.get("approved")]
    if not approved:
        return {"moved": 0, "per_folder": {}, "errors": [], "sorted_manifest_path": None}

    for bucket in buckets:
        (output_dir / bucket).mkdir(parents=True, exist_ok=True)

    per_folder: dict[str, int] = {b: 0 for b in buckets}
    errors: list[str] = []
    used_names: dict[str, set[str]] = {b: set() for b in buckets}

    for row in approved:
        folder = (row.get("user_folder") or row.get("suggested_folder") or "unknown").strip()
        if folder not in buckets:
            folder = "unknown"
        src = Path(row["original_path"])
        if not src.exists():
            errors.append(f"Missing file: {src}")
            continue

        dest_dir = output_dir / folder
        dest_name = generate_filename(row, src.suffix.lower())

        stem = Path(dest_name).stem
        suffix = Path(dest_name).suffix
        counter = 1
        while (dest_dir / dest_name).exists() or dest_name in used_names[folder]:
            dest_name = f"{stem}-{counter}{suffix}"
            counter += 1

        try:
            shutil.move(str(src), str(dest_dir / dest_name))
            used_names[folder].add(dest_name)
            per_folder[folder] = per_folder.get(folder, 0) + 1
            row["renamed_to"] = dest_name
            row["moved_to_folder"] = folder
        except OSError as e:
            errors.append(f"{src}: {e}")

    sorted_manifest = dict(manifest)
    sorted_manifest["sorted_at"] = datetime.now().isoformat()
    sorted_manifest["output_dir"] = str(output_dir)
    sorted_manifest["moved_per_folder"] = per_folder
    sorted_manifest["sort_errors"] = errors

    sorted_path = runs_dir / f"{run_id}_sorted_manifest.json"
    with open(sorted_path, "w", encoding="utf-8") as f:
        json.dump(sorted_manifest, f, indent=2)

    return {
        "moved": sum(per_folder.values()),
        "per_folder": per_folder,
        "errors": errors,
        "sorted_manifest_path": str(sorted_path),
    }
