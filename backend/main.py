"""
FastAPI application entry point.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import config
from backend.routes.photos import router as photos_router
from backend.routes.analysis import router as analysis_router
from backend.routes.models import router as models_router

app = FastAPI(
    title="Lightroom Preset Selector",
    description="AI-powered Lightroom preset recommendations for dating profile photos.",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(photos_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(models_router, prefix="/api")

config.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
config.ANALYZED_DIR.mkdir(parents=True, exist_ok=True)
config.ERRORED_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/thumbnails",
    StaticFiles(directory=str(config.THUMBNAILS_DIR)),
    name="thumbnails",
)

config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/processed",
    StaticFiles(directory=str(config.OUTPUT_DIR)),
    name="processed",
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "3.0.0"}
