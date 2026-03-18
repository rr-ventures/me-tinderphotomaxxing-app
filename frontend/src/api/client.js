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

export async function uploadPhotos(files, onProgress) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  const xhr = new XMLHttpRequest()
  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.detail || `Upload failed: ${xhr.status}`))
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }
    })
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
    xhr.open('POST', `${API_BASE}/photos/upload`)
    xhr.send(formData)
  })
}

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

export async function blurPreviewUrl(photoId) {
  const response = await fetch(`${API_BASE}/photos/${photoId}/blur-preview`, {
    method: 'POST',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || 'Blur preview failed')
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// ── Analysis endpoints ──────────────────────────────────────────────────

export async function analyzeSingle(photoId, model) {
  return post('/analyze/single', { photo_id: photoId, model })
}

export async function analyzeBatch(model, limit, allFolders = false) {
  return post('/analyze/batch', { model, limit, all_folders: allFolders || undefined })
}

export async function retryFailed(runId) {
  return post(`/analyze/retry/${runId}`)
}

export async function getAnalysisProgress() {
  return get('/analyze/batch/progress')
}

export async function listRuns() {
  return get('/runs')
}

export async function getRun(runId) {
  return get(`/runs/${runId}`)
}

export async function downloadRunPhotos(runId, photoIds = null, folder = 'analyzed') {
  const params = new URLSearchParams({ folder })
  if (photoIds && photoIds.length > 0) {
    params.set('photo_ids', photoIds.join(','))
  }
  const url = `${API_BASE}/runs/${runId}/download?${params}`
  const response = await fetch(url)
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(err.detail || `Download failed: ${response.status}`)
  }
  const blob = await response.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `run_${runId}_photos.zip`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function getFolderCounts() {
  return get('/photos/folder-counts')
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
