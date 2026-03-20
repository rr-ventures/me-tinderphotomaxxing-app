# Photo Analyser

AI-powered photo analysis that tells you which Lightroom presets and edits will work best for each of your photos. Upload a batch, let Gemini analyse them, then preview, crop, enhance and download the results.

---

## What it does

You drop in your photos, the app runs them through Google's Gemini AI, and for each photo you get:

- A recommended Lightroom preset with a live CSS preview
- A style recommendation (e.g. Warm Golden, Moody Cinematic, Bright & Airy)
- Crop suggestions based on the photo's content
- AI upscale / enhancement options
- One-click bulk download as a ZIP

---

## Getting started

You'll need a **Gemini API key** from [Google AI Studio](https://aistudio.google.com).

1. Add your key — create a file called `.env` in the project root:
   ```
   GEMINI_API_KEY=your_key_here
   ```

2. Start the app:
   ```bash
   # Backend
   uvicorn backend.main:app --reload --port 8000 --reload-exclude "frontend/*" --reload-exclude "data/*"

   # Frontend (in a second terminal)
   cd frontend && npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000)

### Dev Container (VS Code / Cursor)

The dev container **starts the API and Vite for you** whenever the container starts or you attach to it (`scripts/ensure-dev-servers.sh` via `postStartCommand` / `postAttachCommand`). Ports **3000** and **8000** are forwarded automatically.

- If the browser still can’t connect: open the **Ports** view, confirm **3000** is forwarded, and click **Open in Browser**.
- Manual restart: `bash scripts/ensure-dev-servers.sh` or run the task **Photo Analyser: ensure dev servers**.

---

## How to use it

### Step 1 — Upload your photos
Drag and drop photos onto the Dashboard, or drop them directly into the `data/to_process/` folder. Supports JPG, PNG, WebP, HEIC, TIFF, BMP.

### Step 2 — Run analysis
Choose a model and click **Analyse Photos**. A progress bar shows each photo as it's processed. When done, you're taken straight to the results.

- Photos that succeed move to `data/analyzed/`
- Photos that fail (e.g. rate limit errors) move to `data/errored/` and can be retried

### Step 3 — Review results
The Analysis page shows all your photos with their recommendations. Click any photo to open the detail view where you can:

- **Preview presets** — see a live CSS approximation of each Lightroom preset
- **Crop** — apply the AI-recommended crop or adjust it manually
- **Clarity** — AI upscale focused on sharpness and resolution only
- **Full Enhance** — full AI portrait enhancement (sharpens, lifts shadows, removes noise, preserves identity)
- **Background Blur** — AI bokeh/portrait-mode background blur

### Step 4 — Export
When you're happy with your photos:

- **Download All** — downloads every photo from the run as a ZIP
- **Select photos + Download** — select specific photos and download just those
- **Bulk Save / Bulk Enhance** — process multiple photos at once to `data/processed/`

---

## The 6 photo styles

| Style | Best for |
|---|---|
| **True to Life** | Any photo — safe, natural, authentic |
| **Warm Golden** | Golden hour, sunset, outdoor warmth |
| **Bright & Airy** | Flat daylight, indoor, light backgrounds |
| **Moody Cinematic** | Urban scenes, dramatic lighting, contrast |
| **Nightlife** | Bars, clubs, low light, night shots |
| **Black & White** | Photos with bad or distracting colours |

---

## The pipeline

```
data/to_process/   →   data/analyzed/   →   data/processed/
  (your photos)       (AI done, ready        (exported/saved)
                        to review)

                   →   data/errored/
                       (failed, can retry)
```

The Dashboard shows live counts for each stage so you always know where things are.

---

## Tips

- **Batch size** — you can set a limit (e.g. analyse 50 at a time) to control API costs
- **Retry failed** — if some photos hit rate limits, use the "Retry Failed" button on the Analysis page
- **Past runs** — all previous runs are saved and accessible from the Dashboard
- **Photos are never uploaded to git** — all photo data stays local only

---

## API key & costs

The app uses Google Gemini for analysis. Costs depend on the model chosen:

- **Gemini 3.1 Pro** — most accurate, higher cost (~$0.002–0.004 per photo)

A cost estimate is shown on the Dashboard before you start a run.

Get a key at [aistudio.google.com](https://aistudio.google.com) — there's a free tier.
