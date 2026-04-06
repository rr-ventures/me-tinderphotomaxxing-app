---
name: Batch Processing Overhaul
overview: "Fix 8 distinct issues across the app: folder-based photo lifecycle management, retry-failed-photos, rate-limit backoff improvements, compare UI redesign, preset CSS filter audit, Full Enhance prompt upgrade, and UI overlap fixes."
todos:
  - id: folders
    content: Add analyzed/ and errored/ folders to config, update scanner and photo-serving routes to look in all folders
    status: done
  - id: rate-limit-backoff
    content: Fix Gemini client to parse retryDelay from 429 response and use it; reduce ANALYSIS_CONCURRENCY from 5 to 3
    status: done
  - id: file-lifecycle
    content: Move files to analyzed/ on success and errored/ on permanent failure after batch analysis
    status: done
  - id: retry-endpoint
    content: Add POST /analyze/retry/{run_id} backend endpoint and Retry Failed button on Analysis page
    status: done
  - id: compare-ui
    content: Replace Hold to Compare + 3-up grid with three clickable Original/Clarity/Full Enhance swap buttons in PhotoDetail
    status: done
  - id: preset-css-audit
    content: Audit and fix all PRESET_FILTERS CSS mappings in PhotoDetail.jsx to match actual Lightroom preset behavior
    status: done
  - id: enhance-prompt
    content: Replace Full Enhance upscale prompt with portrait-focused best-practice prompt in backend and frontend
    status: done
  - id: selector-consistency
    content: Fix selector.py tie-breaking so similar photos get consistent preset recommendations
    status: done
isProject: false
---

# Batch Processing & UI Overhaul Plan

## Issues Being Fixed

### 1. Photo Lifecycle Folders

**Problem:** Analyzed photos stay in `to_process/`, so re-running analysis wastes API calls on already-done photos.

**Solution:** Introduce a 3-folder lifecycle:

- `data/to_process/` — not yet analyzed (existing)
- `data/analyzed/` — analyzed successfully, awaiting processing (new)
- `data/errored/` — permanently failed after all retries (new)
- `data/processed/` — fully processed/saved (existing)

After a successful batch analysis, each photo's file is **moved** from `to_process/` to `analyzed/`. Failed photos are moved to `errored/`. The Dashboard will scan all three folders and show counts per stage. A "Re-analyze everything" button will still exist to force re-run from any folder.

Key files to change:

- `[backend/config.py](backend/config.py)` — add `ANALYZED_DIR`, `ERRORED_DIR` paths
- `[backend/routes/analysis.py](backend/routes/analysis.py)` — move files after batch completes
- `[backend/images/scanner.py](backend/images/scanner.py)` — update to scan `analyzed/` folder too when needed
- `[backend/routes/photos.py](backend/routes/photos.py)` — update photo serving to look in all folders
- `[frontend/src/pages/Dashboard.jsx](frontend/src/pages/Dashboard.jsx)` — show per-folder counts

---

### 2. Retry Failed Photos

**Problem:** 5 photos failed with 429 rate-limit errors. No way to retry just those without re-running all 250.

**Solution:**

- **Auto-retry first:** After the main batch, any 429 failures are automatically retried once with a longer backoff (wait the full `retryDelay` seconds from the error response, then retry).
- **Retry Failed button:** If auto-retry still fails, the Analysis page shows a "Retry Failed (5)" button. Clicking it re-runs only the failed photos and merges results into the existing run JSON.
- **Error explanation:** Each failed photo shows the specific error reason (e.g. "Rate limit — quota of 25 req/min exceeded").
- **Moved to `errored/`** only after all retries are exhausted.

Key files:

- `[backend/gemini/client.py](backend/gemini/client.py)` — parse `retryDelay` from 429 response and use it (currently hardcodes 5s/10s backoff)
- `[backend/routes/analysis.py](backend/routes/analysis.py)` — add `POST /analyze/retry/{run_id}` endpoint
- `[frontend/src/pages/Analysis.jsx](frontend/src/pages/Analysis.jsx)` — add Retry Failed button
- `[frontend/src/api/client.js](frontend/src/api/client.js)` — add `retryFailed(runId)` call

---

### 3. Rate Limit Backoff Fix

**Problem:** Current retry waits 5s/10s, but the 429 error response says "retry in 33s". This is why retries fail — they retry too soon.

**Solution:** Parse the `retryDelay` value from the Gemini error response and use it as the actual sleep duration (capped at 60s). Also reduce `ANALYSIS_CONCURRENCY` from 5 to 3 to stay under the 25 req/min quota more safely.

Key file: `[backend/gemini/client.py](backend/gemini/client.py)` lines 96–142

---

### 4. Compare UI Redesign (click to swap, not hold)

**Problem:** "Hold to Compare" button overlaps with other UI elements. The 3-up compare grid shows tiny images with no way to see full size.

**Solution:** Replace the current compare UI with **three clickable mode buttons** that swap the full-size main image:

```
[ Original ]  [ Clarity ]  [ Full Enhance ]
```

- Clicking a button sets the active view — no holding required
- The currently active mode is highlighted
- The main image area shows the full-size version of whichever is selected
- Remove the "Hold to Compare" button entirely
- The 3-up grid is removed; comparison is done by clicking between the three buttons

Key file: `[frontend/src/components/PhotoDetail.jsx](frontend/src/components/PhotoDetail.jsx)` lines 86–94, 216–256, 296–322, 362–373

---

### 5. Preset CSS Filter Audit & Fix

**Problem:** CSS filters don't match what the Lightroom presets actually do. "Blur Background Subtle" applies `brightness(1.02) contrast(1.05)` — no blur at all.

**Audit findings from research:**
Each preset's actual Lightroom behavior, and the corrected CSS approximation:


| Preset                        | What Lightroom actually does                                | Corrected CSS                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject > Warm Pop            | Warms subject, boosts exposure + saturation on subject mask | `brightness(1.06) saturate(1.25) sepia(0.18) contrast(1.05)`                                                                                                                                |
| Subject > Light               | Lifts exposure on subject, reduces contrast slightly        | `brightness(1.2) contrast(0.92) saturate(1.05)`                                                                                                                                             |
| Subject > Vibrant             | Boosts saturation + clarity on subject                      | `saturate(1.4) contrast(1.08) brightness(1.03)`                                                                                                                                             |
| Subject > Warm Light          | Warms + lifts subject, soft look                            | `brightness(1.12) saturate(1.12) sepia(0.14) contrast(0.98)`                                                                                                                                |
| Subject > Pop                 | Exposure + texture + clarity on subject                     | `brightness(1.1) contrast(1.18) saturate(1.1)`                                                                                                                                              |
| Subject > Balance Contrast    | Balances highlights/shadows on subject                      | `brightness(1.02) contrast(1.12) saturate(1.0)`                                                                                                                                             |
| Portrait > Polished Portrait  | Subtle face enhancement, even skin                          | `brightness(1.04) contrast(1.04) saturate(1.04)`                                                                                                                                            |
| Portrait > Enhance Portrait   | Lifts face, corrects color cast                             | `brightness(1.1) contrast(1.1) saturate(1.08) hue-rotate(2deg)`                                                                                                                             |
| Portrait > Smooth Facial Skin | Softens skin texture on face mask                           | `brightness(1.02) contrast(0.95) saturate(1.0) blur(0.5px)`                                                                                                                                 |
| Blur Background > Subtle      | AI background blur, subject sharp                           | `blur(1.5px)` on a pseudo-element (not possible in pure CSS on one `<img>`); best approximation: show a note "Background blur — not previewable in CSS" + `brightness(1.02) contrast(1.04)` |
| Style: Cinematic              | Teal-orange grade, lifted shadows                           | `brightness(0.93) contrast(1.22) saturate(0.82) sepia(0.06) hue-rotate(-5deg)`                                                                                                              |
| Portraits: B&W                | Desaturate + contrast                                       | `grayscale(1) contrast(1.18) brightness(1.04)`                                                                                                                                              |
| Portraits: Group              | Balanced multi-face enhancement                             | `brightness(1.05) contrast(1.06) saturate(1.06)`                                                                                                                                            |
| Sky > Blue Pop                | Boosts sky saturation/contrast                              | `saturate(1.3) contrast(1.1) brightness(1.02) hue-rotate(-8deg)`                                                                                                                            |


For "Blur Background > Subtle", since CSS `filter` applies to the whole image (can't blur just the background), the preview thumbnail will show a label "Background blur effect — CSS cannot preview this accurately" instead of a misleading filter.

Key file: `[frontend/src/components/PhotoDetail.jsx](frontend/src/components/PhotoDetail.jsx)` lines 34–60

---

### 6. Full Enhance Prompt Upgrade

**Problem:** Current "Full Enhance" prompt is generic and produces results indistinguishable from Clarity. Need a portrait-focused prompt based on proven best-practice prompts found online.

**New prompt** (synthesized from the ghauseditz.com "Ultra-premium" prompt and geminivisualprompts.com portrait prompt #12, adapted for dating profile photos):

```
Enhance this portrait photo to professional quality. Preserve 100% of the original 
identity — face structure, expression, pose, clothing, and background must remain 
unchanged. Recover fine detail: sharp facial features, natural skin texture with 
visible pores, realistic hair strands, and clean edges. Apply balanced cinematic 
lighting with improved dynamic range — lift shadows slightly, recover highlights, 
without relighting or reshaping. Remove compression artifacts and digital noise. 
Apply controlled sharpening. Do NOT smooth skin artificially, do NOT alter facial 
anatomy, do NOT change colors dramatically. Output should read as a true-to-life 
photorealistic enhancement — the same photo, only clearer, sharper, and higher 
resolution.
```

Key files:

- `[backend/routes/photos.py](backend/routes/photos.py)` — `UPSCALE_PROMPTS["enhance"]`
- `[frontend/src/components/PhotoDetail.jsx](frontend/src/components/PhotoDetail.jsx)` — `PROMPTS.enhance` display string

---

### 7. Inconsistent Preset Recommendations for Similar Photos

**Problem:** Very similar photos get different preset recommendations.

**Root cause:** The analysis sends images resized to 1024px to Gemini, which extracts `scene_type`, `lighting`, `color_quality`, `face_visible` etc. Small differences in these extracted fields (e.g. `natural_warm` vs `golden_hour`) map to different scenarios in the YAML, producing different presets.

**Fix:** Add a confidence/stability mechanism — if a photo's metadata fields are borderline (e.g. lighting is ambiguous), the selector should return the same top preset as the most common result across similar photos. This is a backend `selector.py` change to prefer the most-matched scenario when multiple scenarios score equally.

Key file: `[backend/analysis/selector.py](backend/analysis/selector.py)` — review scoring logic and add tie-breaking by scenario priority order

---

### 8. Progress Bar Was Missing During Analysis

This was already fixed in the previous session. Confirmed working per your message ("hey, it did").

---

## Implementation Order

1. Config + folder structure (backend) — unblocks everything else
2. Rate limit backoff fix in Gemini client
3. File lifecycle moves in analysis route
4. Retry Failed endpoint + frontend button
5. Compare UI redesign in PhotoDetail
6. Preset CSS filter audit + fix
7. Full Enhance prompt upgrade
8. Selector tie-breaking for consistent recommendations

