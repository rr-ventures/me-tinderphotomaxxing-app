/*
 * LEARNING NOTE: API Client — how the React frontend talks to the Python backend.
 *
 * PYTHON COMPARISON:
 *   In Python, you'd use: response = requests.get("http://localhost:8000/api/photos")
 *   In JavaScript, we use: const response = await fetch("/api/photos")
 *
 *   They do the same thing — send an HTTP request and get data back.
 *   The main difference is JavaScript uses "await" more explicitly.
 *
 * WHY A SEPARATE FILE?
 *   Instead of writing fetch() calls in every component, we put them
 *   all here. This way, if the API changes, we only update one file.
 *   This is called "separation of concerns" — a key software engineering principle.
 */

const API_BASE = '/api'

async function get(path) {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || `API error: ${response.status}`)
  }
  return response.json()
}

async function post(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value)
    }
  })
  const response = await fetch(url.toString(), { method: 'POST' })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || `API error: ${response.status}`)
  }
  return response.json()
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || `API error: ${response.status}`)
  }
  return response.json()
}

// ── Photo endpoints ─────────────────────────────────────────────────────

export async function listPhotos() {
  return get('/photos')
}

export async function getPhotoCount() {
  return get('/photos/count')
}

export async function rotatePhoto(photoId) {
  return post(`/photos/${photoId}/rotate`)
}

export async function upscalePhoto(photoId) {
  return post(`/photos/${photoId}/upscale`)
}

export async function savePhoto(photoId) {
  return post(`/photos/${photoId}/save`)
}

export async function cropPhoto(photoId, crop) {
  return postJson(`/photos/${photoId}/crop`, crop)
}

export async function applyEdits(photoId, adjustments) {
  return postJson(`/photos/${photoId}/apply-edits`, { adjustments })
}

export async function previewEditsUrl(photoId, adjustments) {
  const response = await fetch(`${API_BASE}/photos/${photoId}/preview-edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments }),
  })
  if (!response.ok) {
    throw new Error('Preview failed')
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function previewPhotoUrl(photoId, { crop, adjustments } = {}) {
  const response = await fetch(`${API_BASE}/photos/${photoId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ crop: crop || null, adjustments: adjustments || null }),
  })
  if (!response.ok) {
    throw new Error('Preview failed')
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function getSliderRanges(photoId, style) {
  return get(`/photos/${photoId}/slider-ranges?style=${style}`)
}

export async function processPhoto(photoId, options) {
  return postJson(`/photos/${photoId}/process`, options)
}

export async function batchProcess(photoIds, actions) {
  return postJson('/photos/batch-process', { photo_ids: photoIds, actions })
}

export async function batchEnhance(photoIds, { runId, crop, upscale, upscaleMode, save, renameToPreset } = {}) {
  return postJson('/photos/batch-enhance', {
    photo_ids: photoIds,
    run_id: runId || null,
    crop: !!crop,
    upscale: !!upscale,
    upscale_mode: upscaleMode || 'enhance',
    save: !!save,
    rename_to_preset: !!renameToPreset,
  })
}

export async function batchRename(photoIds, runId) {
  return postJson('/photos/batch-rename', {
    photo_ids: photoIds,
    run_id: runId,
  })
}

export async function getPresetRecommendation(photoId, runId) {
  const params = runId ? `?run_id=${runId}` : ''
  return get(`/photos/${photoId}/preset-recommendation${params}`)
}

export async function getCropOptions(photoId, runId) {
  const params = runId ? `?run_id=${runId}` : ''
  return get(`/photos/${photoId}/crop-recommendation${params}`)
}

export async function upscalePreviewUrl(photoId, { crop, adjustments, mode } = {}) {
  const response = await fetch(`${API_BASE}/photos/${photoId}/upscale-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      crop: crop || null,
      adjustments: adjustments || null,
      mode: mode || 'enhance',
    }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || 'Upscale failed')
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function listProcessed() {
  return get('/processed')
}

// ── Analysis endpoints ──────────────────────────────────────────────────

export async function analyzeSingle(photoId, model) {
  return post('/analyze/single', { photo_id: photoId, model })
}

export async function analyzeBatch(model, limit) {
  return post('/analyze/batch', { model, limit })
}

export async function listRuns() {
  return get('/runs')
}

export async function getRun(runId) {
  return get(`/runs/${runId}`)
}

// ── Model endpoints ─────────────────────────────────────────────────────

export async function listModels() {
  return get('/models')
}

export async function estimateCost(model, numImages) {
  return get(`/models/estimate?model=${model}&num_images=${numImages}`)
}

export async function healthCheck() {
  return get('/health')
}
