"""
ImageStudio — AI-powered bulk image analysis & editing.
Clean Streamlit UI with step-by-step wizard flow.
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
from editor import apply_edits

INPUT_DIR = Path(config.INPUT_DIR).resolve()
RUNS_DIR = Path(config.RUNS_DIR).resolve()
OUTPUT_DIR = Path(config.OUTPUT_DIR).resolve()

IMAGES_PER_PAGE = 20
GRID_COLS = 4


# ── Minimal CSS — only theming, no layout hacks ──────────────────────────────

def _inject_css():
    st.markdown("""<style>
    #MainMenu, footer, header {visibility: hidden;}
    .stDeployButton {display: none;}
    [data-testid="stMetric"] {
        background: #333;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 12px 16px;
    }
    [data-testid="stMetricValue"] { font-weight: 700; }
    .stProgress > div > div {
        background: linear-gradient(90deg, #2680EB, #56a0f5) !important;
    }
    </style>""", unsafe_allow_html=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _list_runs() -> list[Path]:
    if not RUNS_DIR.exists():
        return []
    return sorted(
        (f for f in RUNS_DIR.glob("*.json")
         if not f.name.endswith("_errors.json")
         and not f.name.endswith("_sorted_manifest.json")
         and not f.name.endswith("_edit_results.json")),
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
        "dashboard": ["has_results", "analyzing", "processing", "edit_results",
                       "manifest", "images", "manifest_path", "analysis_paths"],
        "review": ["analyzing", "processing", "edit_results"],
        "analyzing": ["has_results", "processing", "edit_results"],
    }
    for k in clear_map.get(screen, []):
        st.session_state.pop(k, None)
    if screen == "review":
        st.session_state.has_results = True


def _load_run(path: Path):
    m = _load_manifest(path)
    st.session_state.manifest_path = str(path)
    st.session_state.manifest = m
    st.session_state.images = list((m or {}).get("images", []))
    st.session_state.has_results = True
    for k in ("edit_results", "processing", "analyzing"):
        st.session_state.pop(k, None)


def _auto_save():
    manifest = st.session_state.get("manifest")
    path = st.session_state.get("manifest_path")
    images = st.session_state.get("images")
    if manifest and path and images:
        manifest["images"] = images
        _save_manifest(manifest, Path(path))


def _current_screen() -> str:
    if st.session_state.get("edit_results"):
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
    return sum(
        1 for f in folder.rglob("*")
        if f.is_file() and f.suffix.lower() in config.SUPPORTED_EXTENSIONS
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

    if screen == "complete":
        _screen_complete()
    elif screen == "processing":
        _screen_processing()
    elif screen == "review":
        _screen_review()
    elif screen == "analyzing":
        _screen_analyzing()
    else:
        _screen_dashboard()


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
            n = len(images)
            needs_edit = sum(1 for img in images if img.get("recommendations"))
            approved = sum(1 for img in images if img.get("approved_edits"))
            st.metric("Images Analyzed", n)
            st.metric("Need Edits", needs_edit)
            st.metric("Approved", approved)

            tok = manifest.get("token_usage")
            if tok and tok.get("total_tokens"):
                cost = estimate_analysis_cost(tok)
                st.metric("API Cost", f"${cost:.4f}")

        runs = _list_runs()
        if runs and screen in ("dashboard", "review"):
            st.divider()
            st.caption("Recent runs")
            for r in runs[:5]:
                m = _load_manifest(r)
                n_imgs = len((m or {}).get("images", [])) if m else 0
                label = f"{r.stem} ({n_imgs} imgs)"
                current = st.session_state.get("manifest_path", "")
                if str(r) == current:
                    st.caption(f"▶ {label}")
                else:
                    if st.button(label, key=f"run_{r.name}", use_container_width=True):
                        _load_run(r)
                        st.rerun()


# ── SCREEN: Dashboard ─────────────────────────────────────────────────────────

def _screen_dashboard():
    st.title("ImageStudio")
    st.write("AI-powered bulk image analysis and editing. "
             "Drop your photos in the `to_process/` folder, then analyze them below.")

    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    total = _count_images(INPUT_DIR)

    st.divider()

    if total == 0:
        st.info(
            "**No images found.** Add your images to the `to_process/` folder "
            "(drag & drop in the file tree on the left), then come back here."
        )
        if st.button("Refresh"):
            st.rerun()
        return

    # Show count and folder info
    c1, c2 = st.columns(2)
    c1.metric("Images Ready", total)
    c2.metric("Folder", "to_process/")

    # Check API key
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        st.error("**No API key.** Add `GEMINI_API_KEY=your_key` to the `.env` file, then refresh.")
        return

    st.divider()
    st.subheader("Start Analysis")
    st.write(
        f"The AI will look at each image using **{config.ANALYSIS_MODEL}** and recommend:\n\n"
        f"- **Rotation** — fix sideways or upside-down photos (free, done locally)\n"
        f"- **Upscale** — increase resolution if below {config.MIN_RESOLUTION_SHORT_SIDE}px (~${config.PRICING.get(config.EDIT_MODEL, {}).get('per_image_2k', 0.20):.2f}/image)\n"
        f"- **Filters** — color correction, brightness, contrast, etc. (~${config.PRICING.get(config.EDIT_MODEL, {}).get('per_image_2k', 0.20):.2f}/image)\n\n"
        f"You'll review every recommendation before anything is applied."
    )

    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button(f"🧪 Test on {config.TEST_SAMPLE_SIZE} images", use_container_width=True):
            _start_analysis(test_mode=True)
            st.rerun()
    with col2:
        if st.button(f"🚀 Analyze all {total} images", type="primary", use_container_width=True):
            _start_analysis(test_mode=False)
            st.rerun()
    with col3:
        runs = _list_runs()
        if runs:
            if st.button("📂 Load last run", use_container_width=True):
                _load_run(runs[0])
                st.rerun()
        else:
            st.button("📂 No previous runs", use_container_width=True, disabled=True)

    # Preview grid
    st.divider()
    st.subheader("Preview")
    _render_preview(INPUT_DIR, min(total, 8))


def _render_preview(folder: Path, max_show: int):
    files = sorted(
        (f for f in folder.rglob("*")
         if f.is_file() and f.suffix.lower() in config.SUPPORTED_EXTENSIONS),
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
                img.thumbnail((256, 256))
                st.image(img, caption=f.name[:25], use_container_width=True)
            except Exception:
                st.caption(f.name)


# ── Analysis logic ────────────────────────────────────────────────────────────

def _start_analysis(test_mode: bool):
    paths = scan_image_paths(INPUT_DIR)
    if test_mode:
        paths = paths[:config.TEST_SAMPLE_SIZE]

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    manifest_path = RUNS_DIR / f"{ts}.json"
    manifest = {
        "run_id": ts,
        "input_dir": str(INPUT_DIR),
        "status": "incomplete",
        "test_mode": test_mode,
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
        manifest["total_analyzed"] = len(manifest["images"])
        manifest["total_errors"] = len(manifest["errors"])
        _save_manifest(manifest, Path(manifest_path))
        st.session_state.images = list(manifest["images"])
    except Exception as e:
        st.error(f"Retry failed: {e}")


# ── SCREEN: Analyzing ─────────────────────────────────────────────────────────

def _screen_analyzing():
    st.title("Analyzing...")

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

    st.write(f"Processing **{total}** images in batches of {batch_size} "
             f"using **{config.ANALYSIS_MODEL}**.")

    progress_bar = st.progress(0.0)
    status_text = st.empty()
    cost_text = st.empty()

    remaining_paths = list(paths)
    max_retry_rounds = 3

    for retry_round in range(max_retry_rounds + 1):
        if not remaining_paths:
            break

        if retry_round > 0:
            status_text.info(
                f"Retrying {len(remaining_paths)} failed file(s) "
                f"(attempt {retry_round} of {max_retry_rounds})..."
            )

        batches = [remaining_paths[i:i + batch_size]
                    for i in range(0, len(remaining_paths), batch_size)]
        round_errors = []

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
            pct = min(n_done / total, 1.0)
            progress_bar.progress(pct, text=f"{n_done} / {total} images")
            cost = estimate_analysis_cost(manifest["token_usage"])
            cost_text.caption(
                f"Cost so far: ${cost:.4f} · "
                f"{manifest['token_usage']['total_tokens']:,} tokens"
            )

        remaining_paths = [
            Path(e["path"]) for e in round_errors
            if e.get("path") and e["path"] != "?" and Path(e["path"]).exists()
        ]
        if not remaining_paths:
            break

    # Record any final errors
    if remaining_paths:
        for p in remaining_paths:
            manifest["errors"].append({
                "path": str(p), "filename": p.name,
                "error": "Failed after all retry rounds",
            })

    # Completeness check — catch files that fell through the cracks
    analyzed_set = {img["original_path"] for img in manifest["images"]}
    error_set = {e["path"] for e in manifest.get("errors", []) if e.get("path")}
    missed = {str(p) for p in paths} - analyzed_set - error_set

    if missed:
        missed_paths = [Path(p) for p in missed if Path(p).exists()]
        if missed_paths:
            status_text.write(f"Picking up {len(missed_paths)} missed file(s)...")
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
                        "error": "Failed during final completeness retry",
                    })

    # Finalize
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

    needs_edit = sum(1 for img in manifest["images"] if img.get("recommendations"))
    cost = estimate_analysis_cost(manifest["token_usage"])

    if n_errs > 0:
        st.warning(f"Done — {n_imgs} analyzed, {n_errs} error(s), {needs_edit} need edits. Cost: ${cost:.4f}")
    else:
        st.success(f"Done — {n_imgs}/{total} analyzed, {needs_edit} need edits. Cost: ${cost:.4f}")

    status_text.empty()
    cost_text.empty()

    if st.button("Review Results →", type="primary", use_container_width=True):
        st.rerun()


# ── SCREEN: Review ────────────────────────────────────────────────────────────

def _screen_review():
    images = st.session_state.get("images", [])
    manifest = st.session_state.get("manifest") or {}

    if not images:
        st.info("No results yet. Run an analysis first.")
        if st.button("Back to Dashboard"):
            _go_to("dashboard")
            st.rerun()
        return

    st.title("Review Results")

    if manifest.get("test_mode"):
        st.warning("This was a **test run** — only a sample was analyzed. "
                    "Go back to the dashboard to run the full analysis when ready.")

    # Completeness warning
    total_queued = manifest.get("total_queued", 0)
    n_errs = len(manifest.get("errors", []))
    if total_queued > 0 and len(images) + n_errs < total_queued:
        gap = total_queued - len(images) - n_errs
        st.error(f"**{gap} file(s)** were not processed. Consider re-running analysis.")

    # Summary
    n = len(images)
    needs_rotation = sum(1 for img in images
                         for r in img.get("recommendations", []) if r["type"] == "rotation")
    needs_upscale = sum(1 for img in images
                        for r in img.get("recommendations", []) if r["type"] == "upscale")
    needs_filter = sum(1 for img in images
                       for r in img.get("recommendations", []) if r["type"] == "filter")
    needs_any = sum(1 for img in images if img.get("recommendations"))
    no_edits = n - needs_any

    tok = manifest.get("token_usage", {})
    analysis_cost = estimate_analysis_cost(tok)

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total", n)
    c2.metric("Rotation", needs_rotation)
    c3.metric("Upscale", needs_upscale)
    c4.metric("Filters", needs_filter)
    c5.metric("OK as-is", no_edits)

    st.divider()

    # Tabs
    tab_all, tab_rotation, tab_upscale, tab_filter, tab_ok = st.tabs([
        f"All ({n})",
        f"🔄 Rotation ({needs_rotation})",
        f"📐 Upscale ({needs_upscale})",
        f"✨ Filters ({needs_filter})",
        f"✅ No Edits ({no_edits})",
    ])

    with tab_all:
        _render_grid(images, "all")
    with tab_rotation:
        _render_grid(
            [img for img in images
             if any(r["type"] == "rotation" for r in img.get("recommendations", []))],
            "rotation",
        )
    with tab_upscale:
        _render_grid(
            [img for img in images
             if any(r["type"] == "upscale" for r in img.get("recommendations", []))],
            "upscale",
        )
    with tab_filter:
        _render_grid(
            [img for img in images
             if any(r["type"] == "filter" for r in img.get("recommendations", []))],
            "filter",
        )
    with tab_ok:
        _render_grid(
            [img for img in images if not img.get("recommendations")],
            "ok",
        )

    # Errors
    if n_errs > 0:
        st.divider()
        with st.expander(f"⚠️ {n_errs} error(s)"):
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

    # Batch actions
    st.subheader("Bulk Actions")
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        if st.button("✅ Approve all edits", use_container_width=True):
            for img in images:
                img["approved_edits"] = [r["type"] for r in img.get("recommendations", [])]
            _auto_save()
            st.rerun()
    with col2:
        if st.button("🔄 Approve rotations only", use_container_width=True):
            for img in images:
                approved = set(img.get("approved_edits", []))
                for r in img.get("recommendations", []):
                    if r["type"] == "rotation":
                        approved.add("rotation")
                img["approved_edits"] = list(approved)
            _auto_save()
            st.rerun()
    with col3:
        if st.button("🆓 Approve free edits only", use_container_width=True):
            for img in images:
                approved = set(img.get("approved_edits", []))
                for r in img.get("recommendations", []):
                    if r.get("estimated_cost", 0) == 0:
                        approved.add(r["type"])
                img["approved_edits"] = list(approved)
            _auto_save()
            st.rerun()
    with col4:
        if st.button("❌ Clear all approvals", use_container_width=True):
            for img in images:
                img["approved_edits"] = []
            _auto_save()
            st.rerun()

    # Cost summary + apply
    n_approved = sum(1 for img in images if img.get("approved_edits"))
    total_cost = estimate_total_edit_cost(images)

    st.divider()
    st.subheader("Apply Edits")

    if n_approved == 0:
        st.info("Approve at least one edit above to continue.")
    else:
        free_count = sum(
            1 for img in images
            for r in img.get("recommendations", [])
            if r["type"] in img.get("approved_edits", []) and r.get("estimated_cost", 0) == 0
        )
        paid_count = sum(
            1 for img in images
            for r in img.get("recommendations", [])
            if r["type"] in img.get("approved_edits", []) and r.get("estimated_cost", 0) > 0
        )

        st.write(
            f"**{n_approved} image(s)** with approved edits. "
            f"{free_count} free edit(s), {paid_count} paid edit(s). "
            f"**Estimated cost: ${total_cost:.2f}**"
        )

        if total_cost > 0:
            st.caption(f"Analysis cost was ${analysis_cost:.4f}. "
                       f"Edit cost will be ~${total_cost:.2f} on top of that.")

        if st.button(
            f"Apply {n_approved} edit(s) →" + (f" (${total_cost:.2f})" if total_cost > 0 else " (free)"),
            type="primary",
            use_container_width=True,
        ):
            _auto_save()
            st.session_state.processing = True
            st.rerun()


def _render_grid(images: list[dict], tab_key: str):
    if not images:
        st.caption("No images in this category.")
        return

    page_key = f"page_{tab_key}"
    page = st.session_state.get(page_key, 0)
    total_pages = max(1, -(-len(images) // IMAGES_PER_PAGE))
    page = min(page, total_pages - 1)

    start = page * IMAGES_PER_PAGE
    page_images = images[start:start + IMAGES_PER_PAGE]

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
                _render_card(img_data)


def _render_card(img_data: dict):
    recs = img_data.get("recommendations", [])
    approved = set(img_data.get("approved_edits", []))
    filename = img_data.get("filename", "?")
    desc = img_data.get("description") or ""
    quality = img_data.get("quality", "unknown")
    meta = img_data.get("metadata", {})

    # Thumbnail
    p = Path(img_data.get("original_path", ""))
    if p.exists():
        try:
            from PIL import Image as PILImage
            thumb = PILImage.open(p)
            thumb.thumbnail((256, 256))
            st.image(thumb, use_container_width=True)
        except Exception:
            st.caption(f"[{filename}]")
    else:
        st.caption(f"[{filename}]")

    # Filename
    st.caption(filename[:30] + ("..." if len(filename) > 30 else ""))

    # Resolution + quality
    if meta.get("width"):
        st.caption(f"{meta['width']}×{meta['height']} · {quality}")

    # Recommendations as checkboxes
    if recs:
        all_images = st.session_state.get("images", [])
        try:
            idx = next(
                i for i, img in enumerate(all_images)
                if img.get("original_path") == img_data.get("original_path")
            )
        except StopIteration:
            idx = id(img_data)

        changed = False
        for rec in recs:
            icon = config.EDIT_TYPES.get(rec["type"], {}).get("icon", "")
            cost_str = "" if rec.get("estimated_cost", 0) == 0 else f" (${rec['estimated_cost']:.2f})"
            key = f"chk_{idx}_{rec['type']}"
            checked = st.checkbox(
                f"{icon} {rec['label']}{cost_str}",
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

    # Detail expander
    with st.expander("Details"):
        if desc:
            st.write(desc)

        analysis = img_data.get("analysis", {})

        orientation = analysis.get("orientation", {})
        if not orientation.get("is_correct", True):
            st.write(f"**Orientation:** Needs {orientation.get('rotation_needed_degrees', 0)}° rotation")
        else:
            st.write("**Orientation:** Correct")

        filters = analysis.get("filters", {})
        if filters.get("assessment"):
            st.write(f"**Quality:** {filters.get('overall_quality', '?')} — {filters['assessment']}")

        if filters.get("suggestions"):
            for s in filters["suggestions"]:
                st.caption(f"• {s.get('type', 'edit')}: {s.get('description', '')}")


# ── SCREEN: Processing ────────────────────────────────────────────────────────

def _screen_processing():
    st.title("Applying Edits...")

    images = st.session_state.get("images", [])
    to_process = [img for img in images if img.get("approved_edits")]

    if not to_process:
        st.info("No edits to apply.")
        st.session_state.processing = False
        st.rerun()
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    total = len(to_process)
    st.write(f"Applying approved edits to **{total}** image(s). "
             f"Output goes to `{config.OUTPUT_DIR}`.")

    progress_bar = st.progress(0.0)
    status_text = st.empty()
    cost_text = st.empty()

    edit_results = []
    total_cost = 0.0

    for i, img_data in enumerate(to_process):
        edits = ", ".join(img_data["approved_edits"])
        status_text.write(f"{i + 1}/{total} — {img_data['filename']} ({edits})")
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
                "original_path": img_data.get("original_path", ""),
                "errors": [{"type": "general", "error": str(e)}],
                "edits_applied": [],
                "output_path": None,
            })

    progress_bar.progress(1.0, text="Done!")
    status_text.success(f"Applied edits to {total} image(s).")

    manifest = st.session_state.get("manifest") or {}
    run_id = manifest.get("run_id", "unknown")
    results_path = RUNS_DIR / f"{run_id}_edit_results.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(edit_results, f, indent=2)

    st.session_state.edit_results = edit_results
    st.session_state.processing = False

    if st.button("View Results →", type="primary", use_container_width=True):
        st.rerun()


# ── SCREEN: Complete ──────────────────────────────────────────────────────────

def _screen_complete():
    edit_results = st.session_state.get("edit_results", [])

    st.title("Complete")

    total_edits = sum(len(r.get("edits_applied", [])) for r in edit_results)
    total_errors = sum(len(r.get("errors", [])) for r in edit_results)
    total_cost = sum(
        e.get("cost", 0) for r in edit_results for e in r.get("edits_applied", [])
    )
    images_with_output = sum(1 for r in edit_results if r.get("output_path"))

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Images Edited", images_with_output)
    c2.metric("Edits Applied", total_edits)
    c3.metric("Errors", total_errors)
    c4.metric("Edit Cost", f"${total_cost:.2f}")

    st.success(f"Edited images saved to `{config.OUTPUT_DIR}`.")

    st.divider()
    st.subheader("Per-Image Results")

    for result in edit_results:
        fname = result.get("filename", "unknown")
        edits = result.get("edits_applied", [])
        errors = result.get("errors", [])
        output = result.get("output_path")

        icon = "✅" if output and not errors else "⚠️" if errors else "—"
        with st.expander(f"{icon} {fname} — {len(edits)} edit(s)"):
            if output and Path(output).exists():
                col1, col2 = st.columns(2)
                with col1:
                    st.caption("Original")
                    orig = Path(result.get("original_path", ""))
                    if orig.exists():
                        try:
                            from PIL import Image as PILImage
                            st.image(PILImage.open(orig), use_container_width=True)
                        except Exception:
                            st.caption("Could not load")
                with col2:
                    st.caption("Edited")
                    try:
                        from PIL import Image as PILImage
                        st.image(PILImage.open(output), use_container_width=True)
                    except Exception:
                        st.caption("Could not load")

            for edit in edits:
                st.write(f"• **{edit['type'].title()}** — ${edit.get('cost', 0):.2f}")

            for err in errors:
                st.error(f"{err.get('type', 'error')}: {err.get('error', 'unknown')}")

    st.divider()
    c1, c2 = st.columns(2)
    with c1:
        if st.button("Start New Project", use_container_width=True):
            for k in list(st.session_state.keys()):
                del st.session_state[k]
            st.rerun()
    with c2:
        if st.button("← Back to Review", use_container_width=True):
            st.session_state.pop("edit_results", None)
            st.rerun()


if __name__ == "__main__":
    main()
