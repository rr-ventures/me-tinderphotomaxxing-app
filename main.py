"""
ImageStudio — CLI entry point.
Quick analysis from the command line. Use `streamlit run app.py` for the full UI.

Usage:
  python main.py            # analyze all images
  python main.py --test     # analyze TEST_SAMPLE_SIZE images only
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

import config
from analyzer import analyze_batch, estimate_analysis_cost, scan_image_paths

load_dotenv()


def save_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="ImageStudio — CLI photo analysis")
    parser.add_argument("--test", action="store_true",
                        help=f"Only analyze {config.TEST_SAMPLE_SIZE} images")
    args = parser.parse_args()

    input_dir = Path(config.INPUT_DIR).resolve()
    runs_dir = Path(config.RUNS_DIR).resolve()
    runs_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        sys.exit(1)

    all_paths = scan_image_paths(input_dir)
    if not all_paths:
        print(f"No supported images found in {input_dir}.")
        sys.exit(0)

    paths = all_paths
    if args.test:
        paths = paths[:config.TEST_SAMPLE_SIZE]
        print(f"TEST MODE: analyzing only {len(paths)} images")
    else:
        print(f"Analyzing {len(paths)} images with {config.ANALYSIS_MODEL}...")

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    manifest_path = runs_dir / f"{ts}.json"
    manifest = {
        "run_id": ts,
        "input_dir": str(input_dir),
        "status": "incomplete",
        "test_mode": args.test,
        "analysis_model": config.ANALYSIS_MODEL,
        "edit_model": config.EDIT_MODEL,
        "images": [],
        "errors": [],
        "token_usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    save_manifest(manifest_path, manifest)

    batch_size = config.BATCH_SIZE
    batches = [paths[i:i + batch_size] for i in range(0, len(paths), batch_size)]
    global_done = 0

    for batch_num, batch in enumerate(batches, 1):
        print(f"\n--- Batch {batch_num}/{len(batches)} ({len(batch)} images) ---")

        def progress(done: int, batch_total: int) -> None:
            overall = global_done + done
            print(f"  {overall}/{global_done + batch_total}...", end="\r")

        results, errors, usage = asyncio.run(analyze_batch(batch, progress_callback=progress))
        print()

        manifest["images"].extend(results)
        manifest["errors"].extend(errors)
        for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
            manifest["token_usage"][k] += usage.get(k, 0)
        global_done += len(batch)
        save_manifest(manifest_path, manifest)

        needs_edit = sum(1 for r in results if r.get("recommendations"))
        print(f"  {len(results)} analyzed, {needs_edit} need edits, {len(errors)} errors")

    manifest["status"] = "complete"
    save_manifest(manifest_path, manifest)

    tok = manifest["token_usage"]
    cost = estimate_analysis_cost(tok)
    n_imgs = len(manifest["images"])
    n_edits = sum(1 for img in manifest["images"] if img.get("recommendations"))

    print(f"\nAnalysis complete.")
    print(f"  Images: {n_imgs}")
    print(f"  Need edits: {n_edits}")
    print(f"  Errors: {len(manifest['errors'])}")
    print(f"  Tokens: {tok['total_tokens']:,}")
    print(f"  Cost: ${cost:.4f}")
    print(f"\nRun: streamlit run app.py")


if __name__ == "__main__":
    main()
