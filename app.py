"""
ImageStudio — AI-powered bulk image analysis & editing.
Streamlit UI with guided step-by-step wizard flow.

Key principles:
  - Originals are NEVER modified — all edits produce copies
  - Filters are recommendation-only (matched from research report)
  - User controls batch size and previews before committing
"""
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

import streamlit as st

import config
from analyzer import (
    analyze_batch,
    estimate_analysis_cost,
    estimate_total_edit_cost,
    scan_image_paths,
)
from editor import apply_edits, build_output_name, preview_rotation, preview_upscale

INPUT_DIR = Path(config.INPUT_DIR).resolve()
RUNS_DIR = Path(config.RUNS_DIR).resolve()
OUTPUT_DIR = Path(config.OUTPUT_DIR).resolve()

GRID_COLS = 4
PER_PAGE = 16
STEP_NAMES = ["Import", "Analyze", "Review", "Apply", "Done"]


# ── CSS ───────────────────────────────────────────────────────────────────────

def _inject_css():
    st.markdown("""<style>
    #MainMenu, footer, header { visibility: hidden; }
    .stDeployButton { display: none; }
    [data-testid="stMetric"] {
        background: #262626;
        border: 1px solid #383838;
        border-radius: 10px;
        padding: 14px 18px;
    }
    [data-testid="stMetricValue"] { font-weight: 700; }
    .stProgress > div > div {
        background: linear-gradient(90deg, #2680EB, #56a0f5) !important;
    }
    .filter-rec {
        background: #1a1a2e;
        border: 1px solid #2680EB;
        border-radius: 8px;
        padding: 10px 14px;
        margin: 4px 0;
    }
    .rename-badge {
        background: #2d2d2d;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 0.85em;
        color: #56a0f5;
    }
    </style>""", unsafe_allow_html=True)


# ── Step breadcrumb ───────────────────────────────────────────────────────────

def _step_bar(current: int):
    parts = []
    for i, name in enumerate(STEP_NAMES, 1):
        if i < current:
            parts.append(f"✓ {name}")
        elif i == current:
            parts.append(f"**{name}**")
        else:
            parts.append(name)
    st.caption(" → ".join(parts))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _list_runs() -> list[Path]:
    if not RUNS_DIR.exists():
        return []
    return sorted(
        (f for f in RUNS_DIR.glob("*.json")
         if not any(f.name.endswith(s) for s in
                    ("_errors.json", "_sorted_manifest.json", "_edit_results.json"))),
        key=lambda p: p.name, reverse=True,
    )


def _load_manifest(path: Path) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _save_manifest(manifest: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


def _go_to(screen: str):
    clear_map = {
        "dashboard": ["analyzing", "processing", "edit_complete", "analysis_paths",
                       "has_results"],
        "review":    ["analyzing", "processing", "edit_complete"],
        "analyzing": ["has_results", "processing", "edit_complete"],
    }
    for k in clear_map.get(screen, []):
        st.session_state.pop(k, None)
    if screen == "review":
        st.session_state.has_results = True


def _load_run(path: Path):
    m = _load_manifest(path)
    if not m:
        return
    st.session_state.manifest_path = str(path)
    st.session_state.manifest = m
    st.session_state.images = list(m.get("images", []))
    st.session_state.has_results = True
    for k in ("edit_complete", "processing", "analyzing"):
        st.session_state.pop(k, None)


def _auto_save():
    manifest = st.session_state.get("manifest")
    path = st.session_state.get("manifest_path")
    images = st.session_state.get("images")
    if manifest and path and images:
        manifest["images"] = images
        try:
            _save_manifest(manifest, Path(path))
        except OSError:
            pass


def _current_screen() -> str:
    if st.session_state.get("edit_complete"):
        return "complete"
    if st.session_state.get("processing"):
        return "processing"
    if st.session_state.get("analyzing"):
        return "analyzing"
    if st.session_state.get("has_results"):
        return "review"
    return "dashboard"


def _count_images(folder: Path) -> int:
    if not folder.exists():
        return 0
    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    return sum(
        1 for f in folder.rglob("*")
        if f.is_file() and f.suffix.lower() in exts
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    st.set_page_config(
        page_title="ImageStudio",
        page_icon="🎨",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    _inject_css()

    screen = _current_screen()
    _render_sidebar(screen)

    screens = {
        "complete":   _screen_complete,
        "processing": _screen_processing,
        "review":     _screen_review,
        "analyzing":  _screen_analyzing,
    }
    screens.get(screen, _screen_dashboard)()


# ── Sidebar ───────────────────────────────────────────────────────────────────

def _render_sidebar(screen: str):
    with st.sidebar:
        st.subheader("ImageStudio")

        if screen != "dashboard":
            if st.button("← Dashboard", use_container_width=True):
                _go_to("dashboard")
                st.rerun()

        if screen in ("processing", "complete") and st.session_state.get("images"):
            if st.button("← Review", use_container_width=True):
                _go_to("review")
                st.rerun()

        st.divider()

        images = st.session_state.get("images", [])
        manifest = st.session_state.get("manifest") or {}

        if images:
            st.metric("Analyzed", len(images))
            st.metric("Need Edits", sum(1 for img in images if img.get("recommendations")))
            tok = manifest.get("token_usage")
            if tok and tok.get("total_tokens"):
                st.metric("API Cost", f"${estimate_analysis_cost(tok):.4f}")

        runs = _list_runs()
        if runs and screen in ("dashboard", "review"):
            st.divider()
            st.caption("Recent runs")
            for r in runs[:5]:
                m = _load_manifest(r)
                n_imgs = len((m or {}).get("images", [])) if m else 0
                current = st.session_state.get("manifest_path", "")
                if str(r) == current:
                    st.caption(f"▶ {r.stem} ({n_imgs})")
                else:
                    if st.button(f"{r.stem} ({n_imgs})", key=f"run_{r.name}",
                                 use_container_width=True):
                        _load_run(r)
                        st.rerun()


# ── SCREEN 1: Dashboard ──────────────────────────────────────────────────────

def _screen_dashboard():
    _step_bar(1)
    st.title("ImageStudio")
    st.write("AI-powered bulk image analysis and editing.")

    st.info(
        "**Originals are never modified.** All edits produce copies in the "
        f"`{config.OUTPUT_DIR}` folder. Your source files remain untouched."
    )

    INPUT_DIR.mkdir(parents=True, exist_ok=True)

    loaded_images = st.session_state.get("images", [])
    if loaded_images:
        st.success(f"You have **{len(loaded_images)}** analyzed images loaded.")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Continue reviewing →", type="primary", use_container_width=True):
                st.session_state.has_results = True
                st.rerun()
        with c2:
            if st.button("Start fresh", use_container_width=True):
                for k in ["manifest", "images", "manifest_path", "has_results",
                           "edit_complete", "analyzing", "processing"]:
                    st.session_state.pop(k, None)
                st.rerun()
        st.divider()

    total = _count_images(INPUT_DIR)

    if total == 0:
        st.info(
            "**No images found.** Drop your images into the `to_process/` folder "
            "(drag & drop in the file tree on the left), then click Refresh."
        )
        if st.button("🔄 Refresh"):
            st.rerun()
        return

    mc1, mc2 = st.columns([3, 1])
    with mc1:
        st.metric("Images in to_process/", total)
    with mc2:
        if st.button("🔄 Refresh", use_container_width=True):
            st.rerun()

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        st.error("**No API key.** Add `GEMINI_API_KEY=your_key` to `.env`, then refresh.")
        return

    st.divider()
    st.subheader("What will happen")
    st.write(
        f"The AI (**{config.ANALYSIS_MODEL}**) will look at each image and recommend:\n\n"
        f"- **Rotation fix** — straighten sideways/upside-down photos *(free, done locally)*\n"
        f"- **Resolution upscale** — enlarge images below {config.MIN_RESOLUTION_SHORT_SIDE}px "
        f"*( ~${config.PRICING.get(config.EDIT_MODEL, {}).get('per_image_2k', 0.20):.2f}/image)*\n"
        f"- **Filter recommendations** — suggest the best 2 filters from our research report "
        f"*(recommendation only, not applied)*\n"
        f"- **Smart rename** — suggest descriptive filenames based on photo content\n\n"
        f"**You review and approve every recommendation** before anything is applied.\n\n"
        f"**Originals are never modified** — only copies are created."
    )

    st.divider()
    st.subheader("How many images to analyze?")
    st.write(
        f"There are **{total}** images in the folder. "
        f"Choose how many to process in this batch."
    )

    batch_size = st.number_input(
        "Batch size",
        min_value=config.MIN_PROCESS_BATCH_SIZE,
        max_value=min(total, config.MAX_PROCESS_BATCH_SIZE),
        value=min(total, config.DEFAULT_PROCESS_BATCH_SIZE),
        step=10,
        help=f"Process images in batches. You can run multiple batches to cover all {total} images.",
    )

    remaining_after = max(0, total - batch_size)
    if remaining_after > 0:
        st.caption(
            f"This will analyze **{batch_size}** of {total} images. "
            f"**{remaining_after}** will remain for future batches."
        )

    st.divider()
    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button(
            f"🚀  Analyze {batch_size} image(s)",
            type="primary",
            use_container_width=True,
        ):
            _start_analysis(batch_size=batch_size)
            st.rerun()
    with col2:
        if st.button(
            f"🧪  Test on {config.TEST_SAMPLE_SIZE} images",
            use_container_width=True,
        ):
            _start_analysis(batch_size=config.TEST_SAMPLE_SIZE)
            st.rerun()
    with col3:
        runs = _list_runs()
        if runs:
            if st.button("📂  Load last run", use_container_width=True):
                _load_run(runs[0])
                st.rerun()
        else:
            st.button("📂  No previous runs", use_container_width=True, disabled=True)

    if total > 0:
        st.divider()
        st.caption("Preview (first 8 images)")
        _render_preview(INPUT_DIR, min(total, 8))


def _render_preview(folder: Path, max_show: int):
    exts = {e.lower() for e in config.SUPPORTED_EXTENSIONS}
    files = sorted(
        (f for f in folder.rglob("*") if f.is_file() and f.suffix.lower() in exts),
        key=lambda f: f.name,
    )[:max_show]
    if not files:
        return
    cols = st.columns(min(len(files), GRID_COLS))
    for i, f in enumerate(files):
        with cols[i % GRID_COLS]:
            try:
                from PIL import Image as PILImage
                img = PILImage.open(f)
                img.thumbnail((200, 200))
                st.image(img, caption=f.name[:20], use_container_width=True)
                img.close()
            except Exception:
                st.caption(f.name)


# ── Analysis logic ────────────────────────────────────────────────────────────

def _start_analysis(batch_size: int):
    paths = scan_image_paths(INPUT_DIR)
    paths = paths[:batch_size]

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    manifest_path = RUNS_DIR / f"{ts}.json"
    manifest = {
        "run_id": ts,
        "input_dir": str(INPUT_DIR),
        "status": "incomplete",
        "batch_size": batch_size,
        "analysis_model": config.ANALYSIS_MODEL,
        "edit_model": config.EDIT_MODEL,
        "total_queued": len(paths),
        "images": [],
        "errors": [],
        "token_usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    _save_manifest(manifest, manifest_path)
    st.session_state.manifest_path = str(manifest_path)
    st.session_state.manifest = manifest
    st.session_state.analysis_paths = [str(p) for p in paths]
    st.session_state.analyzing = True


def _retry_failed(failed_paths: list[Path]):
    manifest = st.session_state.get("manifest")
    manifest_path = st.session_state.get("manifest_path")
    if not manifest or not manifest_path:
        return

    old_error_strs = {str(p) for p in failed_paths}
    manifest["errors"] = [
        e for e in manifest.get("errors", [])
        if e.get("path") not in old_error_strs
    ]

    try:
        results, errors, usage = asyncio.run(analyze_batch(failed_paths))
        manifest["images"].extend(results)
        manifest["errors"].extend(errors)
        for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
            manifest["token_usage"][k] += usage.get(k, 0)
        _save_manifest(manifest, Path(manifest_path))
        st.session_state.images = list(manifest["images"])
    except Exception as e:
        st.error(f"Retry failed: {e}")


# ── SCREEN 2: Analyzing ──────────────────────────────────────────────────────

def _screen_analyzing():
    _step_bar(2)
    st.title("Analyzing images...")

    manifest = st.session_state.manifest
    manifest_path = Path(st.session_state.manifest_path)
    paths = [Path(p) for p in st.session_state.get("analysis_paths", [])]

    if not paths:
        manifest["status"] = "complete"
        _save_manifest(manifest, manifest_path)
        st.session_state.images = list(manifest.get("images", []))
        st.session_state.analyzing = False
        st.session_state.has_results = True
        st.rerun()
        return

    total = len(paths)
    batch_size = min(config.BATCH_SIZE, total)

    st.write(f"Processing **{total}** images in batches of {batch_size}.")
    st.caption("Each image is analyzed for orientation, resolution, scene/colors, and matched against filter research report.")

    progress_bar = st.progress(0.0)
    status_text = st.empty()
    cost_text = st.empty()

    remaining_paths = list(paths)
    max_retry_rounds = 3
    all_round_errors: list[dict] = []

    for retry_round in range(max_retry_rounds + 1):
        if not remaining_paths:
            break

        if retry_round > 0:
            status_text.info(
                f"Retrying {len(remaining_paths)} failed file(s) "
                f"(attempt {retry_round}/{max_retry_rounds})..."
            )

        batches = [remaining_paths[i:i + batch_size]
                    for i in range(0, len(remaining_paths), batch_size)]
        round_errors: list[dict] = []

        for batch_num, batch in enumerate(batches, 1):
            names = ", ".join(p.name for p in batch[:3])
            if len(batch) > 3:
                names += f" +{len(batch) - 3} more"
            status_text.write(f"Batch {batch_num}/{len(batches)} — {names}")

            try:
                results, errors, usage = asyncio.run(analyze_batch(batch))
            except Exception as e:
                st.error(f"Batch failed: {e}")
                _save_manifest(manifest, manifest_path)
                if st.button("Retry", type="primary"):
                    st.rerun()
                return

            manifest["images"].extend(results)
            for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                manifest["token_usage"][k] += usage.get(k, 0)
            round_errors.extend(errors)
            _save_manifest(manifest, manifest_path)

            n_done = len(manifest["images"])
            progress_bar.progress(min(n_done / total, 1.0), text=f"{n_done} / {total}")
            cost = estimate_analysis_cost(manifest["token_usage"])
            cost_text.caption(f"Cost: ${cost:.4f} · {manifest['token_usage']['total_tokens']:,} tokens")

        remaining_paths = [
            Path(e["path"]) for e in round_errors
            if e.get("path") and e["path"] != "?" and Path(e["path"]).exists()
        ]
        for e in round_errors:
            p = e.get("path", "?")
            if p == "?" or not Path(p).exists():
                all_round_errors.append(e)

    manifest["errors"].extend(all_round_errors)
    for p in remaining_paths:
        manifest["errors"].append({
            "path": str(p), "filename": p.name,
            "error": "Failed after all retry rounds",
        })

    analyzed_set = {img["original_path"] for img in manifest["images"]}
    error_set = {e["path"] for e in manifest.get("errors", []) if e.get("path")}
    missed = {str(p) for p in paths} - analyzed_set - error_set

    if missed:
        missed_paths = [Path(p) for p in missed if Path(p).exists()]
        if missed_paths:
            status_text.write(f"Catching {len(missed_paths)} missed file(s)...")
            try:
                results, errors, usage = asyncio.run(analyze_batch(missed_paths))
                manifest["images"].extend(results)
                manifest["errors"].extend(errors)
                for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                    manifest["token_usage"][k] += usage.get(k, 0)
            except Exception:
                for p in missed_paths:
                    manifest["errors"].append({
                        "path": str(p), "filename": p.name,
                        "error": "Failed during completeness retry",
                    })

    n_imgs = len(manifest["images"])
    n_errs = len(manifest.get("errors", []))
    manifest["total_analyzed"] = n_imgs
    manifest["total_errors"] = n_errs
    manifest["total_queued"] = total
    manifest["status"] = "complete"
    _save_manifest(manifest, manifest_path)

    st.session_state.images = list(manifest["images"])
    st.session_state.analyzing = False
    st.session_state.has_results = True

    progress_bar.progress(1.0, text="Done!")
    status_text.empty()
    cost_text.empty()

    needs_edit = sum(1 for img in manifest["images"] if img.get("recommendations"))
    cost = estimate_analysis_cost(manifest["token_usage"])

    if n_errs > 0:
        st.warning(
            f"**{n_imgs}** images analyzed, **{n_errs}** error(s), "
            f"**{needs_edit}** need edits. Cost: **${cost:.4f}**"
        )
    else:
        st.success(
            f"All **{n_imgs}/{total}** images analyzed, "
            f"**{needs_edit}** need edits. Cost: **${cost:.4f}**"
        )

    if st.button("Review results →", type="primary", use_container_width=True):
        st.rerun()


# ── SCREEN 3: Review ─────────────────────────────────────────────────────────

def _screen_review():
    images = st.session_state.get("images", [])
    manifest = st.session_state.get("manifest") or {}

    if not images:
        _step_bar(3)
        st.info("No results yet. Run an analysis first.")
        if st.button("Back to Dashboard"):
            _go_to("dashboard")
            st.rerun()
        return

    _step_bar(3)
    st.title("Review recommendations")

    st.info(
        "**Originals are never modified.** Approved edits will create copies "
        f"in `{config.OUTPUT_DIR}`. Filter recommendations are for reference only — "
        "they tell you which filter to apply in your editing software."
    )

    if manifest.get("batch_size"):
        total_in_folder = _count_images(INPUT_DIR)
        analyzed = len(images)
        if analyzed < total_in_folder:
            st.warning(
                f"**Batch mode** — {analyzed} of {total_in_folder} images analyzed. "
                f"Go back to the dashboard to analyze more batches."
            )

    # Summary metrics
    n = len(images)
    needs_rotation = sum(1 for img in images
                         for r in img.get("recommendations", []) if r["type"] == "rotation")
    needs_upscale = sum(1 for img in images
                        for r in img.get("recommendations", []) if r["type"] == "upscale")
    has_filter_recs = sum(1 for img in images if img.get("filter_recommendations"))
    needs_any = sum(1 for img in images if img.get("recommendations"))
    no_edits = n - needs_any

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total", n)
    c2.metric("🔄 Rotation", needs_rotation)
    c3.metric("📐 Upscale", needs_upscale)
    c4.metric("✨ Filter Recs", has_filter_recs)
    c5.metric("✅ No edits", no_edits)

    st.divider()

    tab_all, tab_rot, tab_up, tab_filt, tab_ok = st.tabs([
        f"All ({n})",
        f"Rotation ({needs_rotation})",
        f"Upscale ({needs_upscale})",
        f"Filter Recs ({has_filter_recs})",
        f"No edits ({no_edits})",
    ])

    with tab_all:
        _render_grid(images, "all")
    with tab_rot:
        _render_grid(
            [img for img in images
             if any(r["type"] == "rotation" for r in img.get("recommendations", []))],
            "rot",
        )
    with tab_up:
        _render_grid(
            [img for img in images
             if any(r["type"] == "upscale" for r in img.get("recommendations", []))],
            "up",
        )
    with tab_filt:
        _render_grid(
            [img for img in images if img.get("filter_recommendations")],
            "filt",
        )
    with tab_ok:
        _render_grid(
            [img for img in images if not img.get("recommendations")],
            "ok",
        )

    # Errors section
    n_errs = len(manifest.get("errors", []))
    if n_errs > 0:
        st.divider()
        with st.expander(f"⚠️ {n_errs} error(s) — click to view"):
            for e in manifest.get("errors", []):
                st.text(f"{e.get('filename', e.get('path', '?'))}: {e.get('error', '?')}")
            retryable = [
                Path(e["path"]) for e in manifest.get("errors", [])
                if e.get("path") and e["path"] != "?" and Path(e["path"]).exists()
            ]
            if retryable:
                if st.button(f"Retry {len(retryable)} failed file(s)", type="primary"):
                    _retry_failed(retryable)
                    st.rerun()

    st.divider()

    # Bulk actions
    st.subheader("Select edits to apply")
    st.caption("Only rotation and upscale can be applied. Filters are recommendations only.")
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        if st.button("Select all edits", use_container_width=True):
            for img in images:
                img["approved_edits"] = [
                    r["type"] for r in img.get("recommendations", [])
                    if r["type"] in ("rotation", "upscale")
                ]
            _auto_save()
            st.rerun()
    with col2:
        if st.button("Select rotations only", use_container_width=True):
            for img in images:
                approved = set(img.get("approved_edits", []))
                for r in img.get("recommendations", []):
                    if r["type"] == "rotation":
                        approved.add("rotation")
                img["approved_edits"] = list(approved)
            _auto_save()
            st.rerun()
    with col3:
        if st.button("Select upscales only", use_container_width=True):
            for img in images:
                approved = set(img.get("approved_edits", []))
                for r in img.get("recommendations", []):
                    if r["type"] == "upscale":
                        approved.add("upscale")
                img["approved_edits"] = list(approved)
            _auto_save()
            st.rerun()
    with col4:
        if st.button("Clear all selections", use_container_width=True):
            for img in images:
                img["approved_edits"] = []
            _auto_save()
            st.rerun()

    # Apply section
    n_approved = sum(1 for img in images if img.get("approved_edits"))
    total_cost = estimate_total_edit_cost(images)
    analysis_cost = estimate_analysis_cost(manifest.get("token_usage", {}))

    st.divider()
    st.subheader("Apply selected edits")

    if n_approved == 0:
        st.info("Select at least one edit above, then click Apply.")
    else:
        free_count = sum(
            1 for img in images for r in img.get("recommendations", [])
            if r["type"] in img.get("approved_edits", []) and r.get("estimated_cost", 0) == 0
        )
        paid_count = sum(
            1 for img in images for r in img.get("recommendations", [])
            if r["type"] in img.get("approved_edits", []) and r.get("estimated_cost", 0) > 0
        )

        st.write(
            f"**{n_approved} image(s)** selected — "
            f"{free_count} free, {paid_count} paid. "
            f"**Estimated edit cost: ${total_cost:.2f}**"
        )
        if total_cost > 0:
            st.caption(f"Analysis cost was ${analysis_cost:.4f}.")

        st.caption(
            "Files will be renamed based on AI description "
            "(e.g. `Profile Photo - Pool Resort.jpg`). "
            "Originals remain untouched."
        )

        label = f"Apply {n_approved} edit(s)"
        label += f" — ${total_cost:.2f}" if total_cost > 0 else " — free"
        if st.button(label + " →", type="primary", use_container_width=True):
            _auto_save()
            st.session_state.processing = True
            st.rerun()


# ── Image grid ────────────────────────────────────────────────────────────────

def _render_grid(images: list[dict], tab_key: str):
    if not images:
        st.caption("No images in this category.")
        return

    all_images = st.session_state.get("images", [])
    idx_map: dict[str, int] = {}
    for i, img in enumerate(all_images):
        p = img.get("original_path", "")
        if p and p not in idx_map:
            idx_map[p] = i

    page_key = f"page_{tab_key}"
    page = st.session_state.get(page_key, 0)
    total_pages = max(1, -(-len(images) // PER_PAGE))
    page = min(page, total_pages - 1)
    start = page * PER_PAGE
    page_images = images[start:start + PER_PAGE]

    if total_pages > 1:
        pcol1, pcol2, pcol3 = st.columns([1, 2, 1])
        with pcol1:
            if st.button("← Prev", key=f"prev_{tab_key}", disabled=page == 0):
                st.session_state[page_key] = page - 1
                st.rerun()
        with pcol2:
            st.caption(f"Page {page + 1} of {total_pages} · {len(images)} images")
        with pcol3:
            if st.button("Next →", key=f"next_{tab_key}", disabled=page >= total_pages - 1):
                st.session_state[page_key] = page + 1
                st.rerun()

    for row_start in range(0, len(page_images), GRID_COLS):
        row = page_images[row_start:row_start + GRID_COLS]
        cols = st.columns(GRID_COLS)
        for i, img_data in enumerate(row):
            with cols[i]:
                _render_card(img_data, tab_key, idx_map)


def _render_card(img_data: dict, tab_key: str, idx_map: dict[str, int]):
    recs = img_data.get("recommendations", [])
    approved = set(img_data.get("approved_edits", []))
    filename = img_data.get("filename", "?")
    suggested_name = img_data.get("suggested_name", "")

    p = Path(img_data.get("original_path", ""))
    if p.exists():
        try:
            from PIL import Image as PILImage
            thumb = PILImage.open(p)
            thumb.thumbnail((200, 200))
            st.image(thumb, use_container_width=True)
            thumb.close()
        except Exception:
            st.caption(f"[{filename}]")
    else:
        st.caption(f"[{filename}]")

    display_name = filename if len(filename) <= 28 else filename[:25] + "..."
    st.caption(display_name)

    # Show suggested rename
    if suggested_name:
        output_name = build_output_name(img_data)
        st.markdown(
            f'<div class="rename-badge">→ {output_name}</div>',
            unsafe_allow_html=True,
        )

    # Checkboxes for actionable recommendations (rotation, upscale only)
    actionable_recs = [r for r in recs if r["type"] in ("rotation", "upscale")]
    if actionable_recs:
        idx = idx_map.get(img_data.get("original_path", ""), id(img_data))
        changed = False
        for rec in actionable_recs:
            icon = config.EDIT_TYPES.get(rec["type"], {}).get("icon", "")
            cost_tag = "" if rec.get("estimated_cost", 0) == 0 else f" ${rec['estimated_cost']:.2f}"
            key = f"chk_{tab_key}_{idx}_{rec['type']}"
            checked = st.checkbox(
                f"{icon} {rec['label']}{cost_tag}",
                value=rec["type"] in approved,
                key=key,
            )
            if checked and rec["type"] not in approved:
                approved.add(rec["type"])
                changed = True
            elif not checked and rec["type"] in approved:
                approved.discard(rec["type"])
                changed = True

        if changed:
            img_data["approved_edits"] = list(approved)
            _auto_save()

    # Preview buttons
    idx = idx_map.get(img_data.get("original_path", ""), id(img_data))
    preview_col1, preview_col2 = st.columns(2)

    has_rotation = any(r["type"] == "rotation" for r in recs)
    has_upscale = any(r["type"] == "upscale" for r in recs)

    if has_rotation:
        with preview_col1:
            rot_rec = next(r for r in recs if r["type"] == "rotation")
            preview_key = f"prev_rot_{tab_key}_{idx}"
            if st.button("Preview rotation", key=preview_key, use_container_width=True):
                st.session_state[f"show_rot_preview_{idx}"] = True

    if has_upscale:
        with preview_col2 if has_rotation else preview_col1:
            preview_key = f"prev_up_{tab_key}_{idx}"
            if st.button("Preview upscale", key=preview_key, use_container_width=True):
                st.session_state[f"show_up_preview_{idx}"] = True

    # Show rotation preview if requested
    if st.session_state.get(f"show_rot_preview_{idx}") and has_rotation:
        rot_rec = next(r for r in recs if r["type"] == "rotation")
        try:
            preview_img = preview_rotation(p, rot_rec["params"]["degrees"])
            st.image(preview_img, caption=f"Rotated {rot_rec['params']['degrees']}°", use_container_width=True)
            preview_img.close()
        except Exception as e:
            st.error(f"Preview failed: {e}")

    # Show upscale preview if requested
    if st.session_state.get(f"show_up_preview_{idx}") and has_upscale:
        preview_state_key = f"upscale_preview_path_{idx}"
        if preview_state_key not in st.session_state:
            with st.spinner("Generating upscale preview (API call)..."):
                try:
                    preview_path = preview_upscale(p)
                    st.session_state[preview_state_key] = str(preview_path)
                except Exception as e:
                    st.error(f"Upscale preview failed: {e}")
                    st.session_state[preview_state_key] = None

        preview_path = st.session_state.get(preview_state_key)
        if preview_path and Path(preview_path).exists():
            from PIL import Image as PILImage
            prev_img = PILImage.open(preview_path)
            st.image(prev_img, caption="Upscaled preview", use_container_width=True)
            prev_img.close()

    # Filter recommendations (display only, not actionable)
    filter_recs = img_data.get("filter_recommendations", [])
    if filter_recs:
        st.markdown("**✨ Recommended filters:**")
        for fr in filter_recs:
            filt = fr.get("filter", {})
            reason = fr.get("match_reason", "")
            st.markdown(
                f'<div class="filter-rec">'
                f'<strong>{filt.get("name", "?")}</strong> '
                f'<em>({filt.get("category", "")})</em><br>'
                f'<small>{filt.get("description", "")}</small><br>'
                f'<small style="color:#56a0f5">Why: {reason}</small>'
                f'</div>',
                unsafe_allow_html=True,
            )

    # Collapsible details
    with st.expander("Details", expanded=False):
        desc = img_data.get("description") or ""
        meta = img_data.get("metadata", {})
        quality = img_data.get("quality", "unknown")

        if desc:
            st.write(desc)
        if meta.get("width"):
            st.caption(f"{meta['width']}×{meta['height']} · Quality: {quality}")

        analysis = img_data.get("analysis", {})

        scene = analysis.get("scene", {})
        if scene:
            st.write(f"**Setting:** {scene.get('setting', '?')}")
            st.write(f"**Lighting:** {scene.get('lighting', '?')}")
            colors = scene.get("dominant_colors", [])
            if colors:
                st.write(f"**Colors:** {', '.join(colors)}")
            st.write(f"**Mood:** {scene.get('mood', '?')}")

        quality_info = analysis.get("quality", {})
        if quality_info:
            issues = quality_info.get("issues", [])
            if issues:
                st.write(f"**Issues:** {', '.join(issues)}")

        orientation = analysis.get("orientation", {})
        if not orientation.get("is_correct", True):
            st.write(f"**Orientation:** needs {orientation.get('rotation_needed_degrees', 0)}° rotation")


# ── SCREEN 4: Processing ─────────────────────────────────────────────────────

def _screen_processing():
    _step_bar(4)
    st.title("Applying edits...")
    st.caption("Originals are never modified. All edits create copies.")

    images = st.session_state.get("images", [])
    to_process = [img for img in images if img.get("approved_edits")]

    if not to_process:
        st.info("No edits to apply.")
        st.session_state.processing = False
        st.rerun()
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total = len(to_process)

    st.write(f"Applying edits to **{total}** image(s). Output: `{config.OUTPUT_DIR}`")

    progress_bar = st.progress(0.0)
    status_text = st.empty()
    cost_text = st.empty()

    edit_results = []
    total_cost = 0.0

    for i, img_data in enumerate(to_process):
        edits_str = ", ".join(img_data["approved_edits"])
        output_name = build_output_name(img_data)
        status_text.write(f"{i + 1}/{total} — {img_data['filename']} → {output_name} ({edits_str})")
        progress_bar.progress((i + 1) / total, text=f"{i + 1} / {total}")

        try:
            result = apply_edits(img_data, OUTPUT_DIR)
            edit_results.append(result)
            for edit in result.get("edits_applied", []):
                total_cost += edit.get("cost", 0)
            cost_text.caption(f"Edit cost so far: ${total_cost:.2f}")
        except Exception as e:
            edit_results.append({
                "filename": img_data["filename"],
                "output_name": build_output_name(img_data),
                "original_path": img_data.get("original_path", ""),
                "errors": [{"type": "general", "error": str(e)}],
                "edits_applied": [],
                "output_path": None,
            })

    progress_bar.progress(1.0, text="Done!")
    status_text.success(f"Processed {total} image(s).")

    manifest = st.session_state.get("manifest") or {}
    run_id = manifest.get("run_id", "unknown")
    results_path = RUNS_DIR / f"{run_id}_edit_results.json"
    try:
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(edit_results, f, indent=2)
    except OSError:
        pass

    st.session_state.edit_results = edit_results
    st.session_state.edit_complete = True
    st.session_state.processing = False

    if st.button("View results →", type="primary", use_container_width=True):
        st.rerun()


# ── SCREEN 5: Complete ────────────────────────────────────────────────────────

def _screen_complete():
    edit_results = st.session_state.get("edit_results", [])

    _step_bar(5)
    st.title("Done!")

    st.info(
        "All edits were applied to **copies**. Your original files "
        "in `to_process/` are unchanged."
    )

    total_edits = sum(len(r.get("edits_applied", [])) for r in edit_results)
    total_errors = sum(len(r.get("errors", [])) for r in edit_results)
    total_cost = sum(
        e.get("cost", 0) for r in edit_results for e in r.get("edits_applied", [])
    )
    images_with_output = sum(1 for r in edit_results if r.get("output_path"))

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Images edited", images_with_output)
    c2.metric("Edits applied", total_edits)
    c3.metric("Errors", total_errors)
    c4.metric("Edit cost", f"${total_cost:.2f}")

    if images_with_output > 0:
        st.success(f"Edited images saved to `{config.OUTPUT_DIR}`.")
    if total_errors > 0:
        st.warning(f"{total_errors} edit(s) failed. See details below.")

    # Remaining images info
    total_in_folder = _count_images(INPUT_DIR)
    analyzed = len(st.session_state.get("images", []))
    if analyzed < total_in_folder:
        remaining = total_in_folder - analyzed
        st.info(
            f"**{remaining}** images remain unprocessed in `to_process/`. "
            f"Go back to the dashboard to analyze the next batch."
        )

    st.divider()
    st.subheader("Per-image results")

    for result in edit_results:
        fname = result.get("filename", "unknown")
        output_name = result.get("output_name", fname)
        edits = result.get("edits_applied", [])
        errors = result.get("errors", [])
        output = result.get("output_path")

        icon = "✅" if output and not errors else "⚠️" if errors else "—"
        with st.expander(f"{icon} {fname} → {output_name} — {len(edits)} edit(s)"):
            if output and Path(output).exists():
                col1, col2 = st.columns(2)
                with col1:
                    st.caption("Original (unchanged)")
                    orig = Path(result.get("original_path", ""))
                    if orig.exists():
                        try:
                            from PIL import Image as PILImage
                            img = PILImage.open(orig)
                            st.image(img, use_container_width=True)
                            img.close()
                        except Exception:
                            st.caption("Could not load")
                with col2:
                    st.caption(f"Edited copy: {output_name}")
                    try:
                        from PIL import Image as PILImage
                        img = PILImage.open(output)
                        st.image(img, use_container_width=True)
                        img.close()
                    except Exception:
                        st.caption("Could not load")

            for edit in edits:
                st.write(f"• **{edit['type'].title()}** — ${edit.get('cost', 0):.2f}")
            for err in errors:
                st.error(f"{err.get('type', 'error')}: {err.get('error', 'unknown')}")

    st.divider()
    c1, c2 = st.columns(2)
    with c1:
        if st.button("Start new batch", use_container_width=True, type="primary"):
            for k in list(st.session_state.keys()):
                del st.session_state[k]
            st.rerun()
    with c2:
        if st.button("← Back to review", use_container_width=True):
            st.session_state.pop("edit_complete", None)
            st.session_state.pop("edit_results", None)
            st.rerun()


if __name__ == "__main__":
    main()
