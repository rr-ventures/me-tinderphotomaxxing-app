# Lightroom Preset Selector

An AI-powered photo analysis workflow that helps you review batches of photos, understand which Lightroom presets and edits will work best, and export stronger final images.

## What It Does

You upload photos into the app, run them through Gemini for metadata extraction, and get back preset recommendations, crop suggestions, and style classifications for each image. From there you can preview presets with live CSS approximations, crop and rotate, run AI-powered upscale and enhancement, and export processed photos individually or as a ZIP.

The app is built around a pipeline: upload to `to_process/`, analyse, review in `analyzed/`, then export to `processed/`. Failed photos land in `errored/` and can be retried. You can also shortlist, save, and archive photos as you work through them.

## Core Features

- **Batch analysis** using Gemini with progress tracking and retry for failed photos
- **Preset recommendations** matched from a YAML library of Lightroom Adaptive presets
- **Six photo styles**: True to Life, Warm Golden, Bright and Airy, Moody Cinematic, Nightlife, Black and White
- **Crop suggestions** based on photo content, with an interactive crop editor
- **AI enhancement** via Gemini image model: HD Restore, Clarity, Full Enhance, Background Blur
- **Lightroom-style slider editor** for manual adjustments
- **Batch operations**: bulk enhance, bulk rename, bulk save
- **Photo management**: shortlist, saved, archived views with full CRUD
- **Run history** with per-run results, merged views, and ZIP downloads
- **Cost estimates** shown before analysis begins

## Stack

**Backend**: FastAPI, Pillow, pillow-heif, google-genai, PyYAML, NumPy

**Frontend**: React 19, React Router, Vite

## Quick Start

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_key_here
```

Start the backend and frontend in separate terminals:

```bash
# Backend
uvicorn backend.main:app --reload --port 8000 --reload-exclude "frontend/*" --reload-exclude "data/*"

# Frontend
cd frontend && npm install && npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

A dev container config is included that starts both servers automatically.

## Project Structure

```
backend/
  main.py                     FastAPI app, CORS, static mounts
  config.py                   Paths and model configuration
  routes/
    photos.py                 Photo CRUD, upload, edit, export, batch operations
    analysis.py               Analyse, runs, retry, reset
    models.py                 Model listing and cost estimates
  gemini/
    client.py                 Gemini API calls for analysis and enhancement
    parser.py                 Metadata parsing from Gemini responses
  analysis/
    selector.py               Style selection
    preset_matcher.py          Preset matching from YAML library
    crop_matcher.py            Crop recommendation logic
    library_loader.py          YAML library loading
  images/
    scanner.py                File scanning and discovery
    thumbnails.py             Thumbnail generation
    processor.py              Orientation and EXIF handling
    editor.py                 Image adjustments and crop
frontend/
  src/
    pages/                    Dashboard, Photos, Shortlist, Archived, Saved, Analysis, Settings
    components/               PhotoGrid, PhotoDetail, CropEditor, SliderEditor, LightroomPlan
    api/client.js             Centralised API client
library/
  production_preset_recommendations.yml
  production_crop_recommendations.yml
  production_filter_library.yml
data/                         Runtime photo storage (gitignored)
  to_process/  analyzed/  errored/  archived/  processed/  thumbnails/  runs/
```
