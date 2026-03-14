import { useState, useEffect, useCallback, useRef } from 'react'
import CropEditor from './CropEditor'
import {
  processPhoto,
  previewPhotoUrl,
  getPresetRecommendation,
  getCropOptions,
  upscalePreviewUrl,
} from '../api/client'

const UPSCALE_STEPS = [
  { at: 0, text: 'Preparing image...' },
  { at: 1500, text: 'Sending to Gemini AI...' },
  { at: 4000, text: 'AI is enhancing your photo...' },
  { at: 9000, text: 'Rendering enhanced result...' },
  { at: 16000, text: 'Almost done — finalizing...' },
]

const PROMPTS = {
  clarity:
    'Increase the resolution and sharpness of this photo. ' +
    'Focus only on improving pixel clarity, reducing blur and noise, ' +
    'and adding fine detail. Do NOT change the lighting, colors, contrast, ' +
    'mood, or style in any way. The result should look identical to the ' +
    'original but with higher resolution and sharper detail.',
  enhance:
    'Upscale and enhance this photo to higher resolution. ' +
    'Improve clarity, sharpness, and overall quality to make it look ' +
    'like it was taken with a professional camera. You may subtly improve ' +
    'lighting, color balance, and detail to achieve a polished, natural result. ' +
    'Preserve the original composition, subject, and content.',
}

const PRESET_FILTERS = {
  'Adaptive: Subject > Warm Pop': 'brightness(1.05) contrast(1.08) saturate(1.2) sepia(0.15)',
  'Adaptive: Subject > Light': 'brightness(1.15) contrast(0.95) saturate(1.05)',
  'Adaptive: Subject > Vibrant': 'brightness(1.05) contrast(1.1) saturate(1.3)',
  'Adaptive: Subject > Warm Light': 'brightness(1.1) contrast(1.02) saturate(1.1) sepia(0.1)',
  'Adaptive: Subject > Pop': 'brightness(1.08) contrast(1.2) saturate(1.15)',
  'Adaptive: Subject > Balance Contrast': 'brightness(1.02) contrast(1.15)',
  'Adaptive: Portrait > Polished Portrait': 'brightness(1.05) contrast(1.05) saturate(1.05)',
  'Adaptive: Portrait > Enhance Portrait': 'brightness(1.08) contrast(1.08) saturate(1.08)',
  'Adaptive: Portrait > Smooth Facial Skin': 'brightness(1.03) contrast(0.98) saturate(1.02) blur(0.3px)',
  'Adaptive: Blur Background > Subtle': 'brightness(1.02) contrast(1.05)',
  'Style: Cinematic': 'brightness(0.95) contrast(1.2) saturate(0.85) sepia(0.08)',
  'Portraits: Black & White': 'grayscale(1) contrast(1.15) brightness(1.05)',
  'Portraits: Group': 'brightness(1.05) contrast(1.05) saturate(1.05)',
  'Adaptive: Sky > Blue Pop': 'brightness(1.05) contrast(1.1) saturate(1.25)',
}

function getFilterForPreset(presetName) {
  if (PRESET_FILTERS[presetName]) return PRESET_FILTERS[presetName]
  const lower = presetName.toLowerCase()
  if (lower.includes('warm')) return 'brightness(1.08) saturate(1.15) sepia(0.12)'
  if (lower.includes('cinematic') || lower.includes('moody')) return 'brightness(0.95) contrast(1.2) saturate(0.85)'
  if (lower.includes('b&w') || lower.includes('black')) return 'grayscale(1) contrast(1.15)'
  if (lower.includes('vibrant') || lower.includes('pop')) return 'brightness(1.05) contrast(1.12) saturate(1.25)'
  if (lower.includes('light') || lower.includes('bright')) return 'brightness(1.12) contrast(0.95)'
  return 'brightness(1.05) contrast(1.05) saturate(1.08)'
}

function PhotoDetail({ photo, result, runId, onClose }) {
  const [previewSrc, setPreviewSrc] = useState(null)
  const originalSrc = `/api/photos/${photo.id}/full`

  const [recommendations, setRecommendations] = useState([])
  const [dangerZones, setDangerZones] = useState([])
  const [recLoading, setRecLoading] = useState(false)

  const [cropOptions, setCropOptions] = useState([])
  const [cropOptsLoading, setCropOptsLoading] = useState(false)

  const [cropMode, setCropMode] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 })
  const [appliedCrop, setAppliedCrop] = useState(null)
  const [appliedCropLabel, setAppliedCropLabel] = useState(null)
  const [cropLoading, setCropLoading] = useState(false)

  const [upscaleApplied, setUpscaleApplied] = useState(false)
  const [upscaleLoading, setUpscaleLoading] = useState(false)
  const [upscaleSrc, setUpscaleSrc] = useState(null)
  const [upscaleMode, setUpscaleMode] = useState('enhance')
  const [upscaleStep, setUpscaleStep] = useState('')
  const stepTimers = useRef([])

  const [showOriginal, setShowOriginal] = useState(false)
  const [appliedAdjustments, setAppliedAdjustments] = useState(null)
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!result) {
      setFilename(photo.filename.replace(/\.[^.]+$/, ''))
      return
    }
    const scene = result.metadata?.scene_type || 'photo'
    const date = new Date().toISOString().slice(0, 10)
    setFilename(`${scene}_${result.primary_style || 'edited'}_${date}`)
  }, [photo, result])

  useEffect(() => {
    if (!photo?.id) return
    setRecLoading(true)
    setCropOptsLoading(true)

    getPresetRecommendation(photo.id, runId)
      .then(data => {
        setRecommendations(data.recommendations || (data.recommendation ? [data.recommendation] : []))
        setDangerZones(data.danger_zones || [])
      })
      .catch(() => setRecommendations([]))
      .finally(() => setRecLoading(false))

    getCropOptions(photo.id, runId)
      .then(data => setCropOptions(data.crop_options || []))
      .catch(() => setCropOptions([]))
      .finally(() => setCropOptsLoading(false))
  }, [photo?.id, runId])

  const refreshPreview = useCallback(async (cropVal, adjVal) => {
    setUpscaleApplied(false)
    setUpscaleSrc(null)
    const hasCrop = cropVal && !(cropVal.x === 0 && cropVal.y === 0 && cropVal.w === 100 && cropVal.h === 100)
    if (!hasCrop && !adjVal) { setPreviewSrc(null); return }
    try {
      const url = await previewPhotoUrl(photo.id, {
        crop: hasCrop ? cropVal : null,
        adjustments: adjVal,
      })
      setPreviewSrc(url)
    } catch { /* fall back */ }
  }, [photo.id])

  const bestCrop = cropOptions[0] || null

  async function applyRecommendedCrop() {
    if (!bestCrop) return
    setCropLoading(true)
    const coords = bestCrop.crop
    setCrop(coords)
    setAppliedCrop(coords)
    setAppliedCropLabel(bestCrop.scenario_name)
    setCropMode(false)
    await refreshPreview(coords, appliedAdjustments)
    setCropLoading(false)
    setStatus({ type: 'info', message: `"${bestCrop.scenario_name}" crop applied.` })
  }

  async function applyManualCrop() {
    const hasCrop = !(crop.x === 0 && crop.y === 0 && crop.w === 100 && crop.h === 100)
    if (!hasCrop) return
    setCropLoading(true)
    setAppliedCrop(crop)
    setAppliedCropLabel('Manual crop')
    setCropMode(false)
    await refreshPreview(crop, appliedAdjustments)
    setCropLoading(false)
    setStatus({ type: 'info', message: 'Manual crop applied.' })
  }

  function revertCrop() {
    setAppliedCrop(null)
    setAppliedCropLabel(null)
    setCrop({ x: 0, y: 0, w: 100, h: 100 })
    setCropMode(false)
    refreshPreview(null, appliedAdjustments)
    setStatus(null)
  }

  async function applyUpscale() {
    setUpscaleLoading(true)
    setUpscaleStep(UPSCALE_STEPS[0].text)
    setStatus(null)

    stepTimers.current.forEach(t => clearTimeout(t))
    stepTimers.current = UPSCALE_STEPS.slice(1).map(step =>
      setTimeout(() => setUpscaleStep(step.text), step.at)
    )

    try {
      const hasCrop = appliedCrop && !(appliedCrop.x === 0 && appliedCrop.y === 0 && appliedCrop.w === 100 && appliedCrop.h === 100)
      const url = await upscalePreviewUrl(photo.id, {
        crop: hasCrop ? appliedCrop : null,
        adjustments: appliedAdjustments,
        mode: upscaleMode,
      })
      setUpscaleSrc(url)
      setUpscaleApplied(true)
      setStatus({
        type: 'success',
        message: `Enhancement applied (${upscaleMode === 'clarity' ? 'Clarity Only' : 'Full Enhance'}). Hold "Compare" to see original.`,
      })
    } catch (err) {
      setStatus({ type: 'error', message: `Enhancement failed: ${err.message}` })
    } finally {
      stepTimers.current.forEach(t => clearTimeout(t))
      stepTimers.current = []
      setUpscaleLoading(false)
      setUpscaleStep('')
    }
  }

  function revertUpscale() {
    setUpscaleApplied(false)
    setUpscaleSrc(null)
    setStatus(null)
  }

  const displaySrc = showOriginal ? originalSrc : (upscaleSrc || previewSrc || originalSrc)
  const hasEdits = !!appliedCrop || !!appliedAdjustments || upscaleApplied

  if (!result) {
    return (
      <div className="photo-detail-overlay" onClick={onClose}>
        <div className="photo-detail" onClick={e => e.stopPropagation()}>
          <div className="detail-header">
            <h2>{photo.filename}</h2>
            <button className="close-btn" onClick={onClose}>Close</button>
          </div>
          <p className="muted">No analysis results yet. Run analysis from the Dashboard.</p>
          <img src={originalSrc} alt={photo.filename} style={{ width: '100%', borderRadius: 8, marginTop: 16 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="photo-detail-overlay" onClick={onClose}>
      <div className="photo-detail photo-detail-wide" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h2>{photo.filename}</h2>
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>

        <div className="detail-body">
          {/* Left: Photo preview */}
          <div className="detail-photo">
            {cropMode ? (
              <CropEditor
                photoId={photo.id}
                photoWidth={photo.width}
                photoHeight={photo.height}
                crop={crop}
                onCropChange={setCrop}
              />
            ) : (
              <div className="photo-compare-wrapper">
                <img src={displaySrc} alt={photo.filename} />
                {showOriginal && <div className="compare-badge">Original</div>}
              </div>
            )}

            <div className="photo-controls-bar">
              {hasEdits && !cropMode && (
                <div className="preview-badge">
                  {[
                    appliedCrop && 'Cropped',
                    appliedAdjustments && 'Styled',
                    upscaleApplied && 'Enhanced',
                  ].filter(Boolean).join(' + ')}
                </div>
              )}
              {hasEdits && !cropMode && (
                <button
                  className="btn btn-small btn-compare"
                  onMouseDown={() => setShowOriginal(true)}
                  onMouseUp={() => setShowOriginal(false)}
                  onMouseLeave={() => setShowOriginal(false)}
                  onTouchStart={() => setShowOriginal(true)}
                  onTouchEnd={() => setShowOriginal(false)}
                >
                  Hold to Compare
                </button>
              )}
            </div>
          </div>

          {/* Right: Controls */}
          <div className="detail-info">

            {/* ═══ PRESET RECOMMENDATIONS ═══ */}
            <div className="preset-hero">
              {recLoading ? (
                <p className="muted">Loading recommendations...</p>
              ) : recommendations.length > 0 ? (
                <>
                  <div className="preset-hero-label">
                    Top {recommendations.length} Recommended Lightroom Preset{recommendations.length > 1 ? 's' : ''}
                  </div>
                  <p className="preset-hero-subtitle">
                    Based on your photo's detected scenario, here are the best Adaptive presets to apply in Lightroom.
                  </p>

                  {recommendations.map((rec, i) => {
                    const p = rec.preset
                    if (!p) return null
                    const cssFilter = getFilterForPreset(p.name)
                    return (
                      <div key={rec.id || i} className={`preset-card ${i === 0 ? 'preset-card-primary' : ''}`}>
                        <div className="preset-card-rank">#{i + 1}</div>
                        <div className="preset-card-preview">
                          <img
                            src={photo.thumbnail_url || originalSrc}
                            alt={`Preview: ${p.name}`}
                            style={{ filter: cssFilter }}
                          />
                        </div>
                        <div className="preset-card-body">
                          <div className="preset-card-header">
                            <h4 className="preset-card-name">{p.name}</h4>
                            <span className="preset-card-scenario">{rec.name}</span>
                          </div>
                          <div className="preset-card-path">{p.path}</div>

                          <div className="preset-card-evidence">
                            <span className="evidence-label">Why: </span>
                            {p.evidence}
                          </div>

                          {p.also_apply && (
                            <div className="preset-card-also">
                              <span className="also-label">Also apply: </span>{p.also_apply}
                            </div>
                          )}
                          {p.avoid && (
                            <div className="preset-card-avoid">
                              <span className="avoid-label">Avoid: </span>{p.avoid}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </>
              ) : (
                <p className="muted">No preset recommendations available.</p>
              )}
            </div>

            {/* ═══ CROP ═══ */}
            <div className="edit-section">
              <div className="edit-section-header">
                <h3>Crop</h3>
                <div className="edit-section-actions">
                  {appliedCrop && !cropMode && (
                    <>
                      <span className="edit-applied-tag">{appliedCropLabel || 'Applied'}</span>
                      <button className="btn btn-small" onClick={() => setCropMode(true)}>Adjust</button>
                      <button className="btn btn-small btn-danger" onClick={revertCrop}>Revert</button>
                    </>
                  )}
                  {cropMode && (
                    <>
                      <button className="btn btn-small btn-primary" onClick={applyManualCrop} disabled={cropLoading}>
                        {cropLoading ? 'Applying...' : 'Apply'}
                      </button>
                      <button className="btn btn-small" onClick={() => setCropMode(false)}>Cancel</button>
                    </>
                  )}
                </div>
              </div>

              {!cropMode && !appliedCrop && (
                <div className="crop-simple">
                  {cropOptsLoading ? (
                    <p className="muted" style={{ padding: '8px 0' }}>Loading...</p>
                  ) : (
                    <div className="crop-simple-actions">
                      {bestCrop && (
                        <button
                          className="btn btn-primary"
                          onClick={applyRecommendedCrop}
                          disabled={cropLoading}
                        >
                          {cropLoading ? 'Applying...' : `Apply Recommended (${bestCrop.aspect_label})`}
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={() => setCropMode(true)}
                      >
                        Manual Crop
                      </button>
                    </div>
                  )}
                  {bestCrop && (
                    <div className="crop-evidence-inline">
                      <p className="crop-preset-evidence">{bestCrop.evidence}</p>
                      {bestCrop.platform_note && (
                        <p className="crop-preset-platform">{bestCrop.platform_note}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {appliedCrop && !cropMode && bestCrop && (
                <div className="crop-applied-evidence">
                  <p className="crop-preset-evidence">{bestCrop.evidence}</p>
                </div>
              )}
            </div>

            {/* ═══ AI ENHANCEMENT ═══ */}
            <div className="edit-section">
              <div className="edit-section-header">
                <h3>AI Enhancement</h3>
                <div className="edit-section-actions">
                  {!upscaleApplied && !upscaleLoading && (
                    <button className="btn btn-small btn-primary" onClick={applyUpscale}>
                      Apply
                    </button>
                  )}
                  {upscaleApplied && (
                    <>
                      <span className="edit-applied-tag">Applied</span>
                      <button className="btn btn-small btn-danger" onClick={revertUpscale}>Revert</button>
                    </>
                  )}
                </div>
              </div>

              {!upscaleApplied && (
                <div className="upscale-modes">
                  <button
                    className={`upscale-mode-btn ${upscaleMode === 'clarity' ? 'active' : ''}`}
                    onClick={() => setUpscaleMode('clarity')}
                    disabled={upscaleLoading}
                  >
                    <strong>Clarity Only</strong>
                    <span>Resolution + sharpness only. No lighting or color changes.</span>
                  </button>
                  <button
                    className={`upscale-mode-btn ${upscaleMode === 'enhance' ? 'active' : ''}`}
                    onClick={() => setUpscaleMode('enhance')}
                    disabled={upscaleLoading}
                  >
                    <strong>Full Enhance</strong>
                    <span>Resolution + AI lighting, color, and quality improvements.</span>
                  </button>
                </div>
              )}

              <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
                {photo.needs_upscale
                  ? `Short side is ${photo.short_side}px — enhancement recommended (min 1080px for dating apps).`
                  : `Resolution OK (${photo.width}x${photo.height}). Apply for extra sharpness and quality.`}
              </p>

              {upscaleLoading && (
                <div className="upscale-progress">
                  <div className="upscale-progress-bar">
                    <div className="upscale-progress-fill" />
                  </div>
                  <div className="upscale-step-info">
                    <div className="upscale-spinner" />
                    <span>{upscaleStep}</span>
                  </div>
                  <div className="upscale-technical">
                    <span>Model: <code>Gemini Flash Image</code></span>
                    <span>Mode: <code>{upscaleMode === 'clarity' ? 'Clarity Only' : 'Full Enhance'}</code></span>
                  </div>
                </div>
              )}

              {/* Show full prompt + details after applying */}
              {upscaleApplied && !upscaleLoading && (
                <details className="upscale-details" open>
                  <summary>What was applied</summary>
                  <div className="upscale-technical">
                    <span>Model: <code>Gemini Flash Image</code></span>
                    <span>Mode: <code>{upscaleMode === 'clarity' ? 'Clarity Only' : 'Full Enhance'}</code></span>
                  </div>
                  <div className="prompt-display">
                    <div className="prompt-label">Prompt sent to Gemini:</div>
                    <pre className="prompt-text">{PROMPTS[upscaleMode]}</pre>
                  </div>
                </details>
              )}

              {/* Always-visible prompt preview (collapsed) */}
              {!upscaleApplied && !upscaleLoading && (
                <details className="upscale-details">
                  <summary>View prompt that will be sent</summary>
                  <div className="prompt-display">
                    <div className="prompt-label">
                      {upscaleMode === 'clarity' ? 'Clarity Only' : 'Full Enhance'} prompt:
                    </div>
                    <pre className="prompt-text">{PROMPTS[upscaleMode]}</pre>
                  </div>
                </details>
              )}
            </div>

            {/* ═══ Quick metadata ═══ */}
            <details className="detail-section meta-details">
              <summary className="meta-summary">Photo Analysis Details</summary>
              <div className="metadata-grid" style={{ marginTop: 8 }}>
                <MetaItem label="Scene" value={result.metadata?.scene_type} />
                <MetaItem label="Lighting" value={result.metadata?.lighting} />
                <MetaItem label="Quality" value={`${result.metadata?.photo_quality}/10`} />
                <MetaItem label="Colors" value={result.metadata?.color_quality} />
                <MetaItem label="Face" value={result.metadata?.face_visible} />
                <MetaItem label="Expression" value={result.metadata?.expression} />
              </div>
            </details>

            {/* ═══ Danger Zones ═══ */}
            {dangerZones.length > 0 && (
              <details className="detail-section meta-details">
                <summary className="meta-summary">Presets to Use with Caution</summary>
                <div style={{ padding: '8px 14px' }}>
                  {dangerZones.map((dz, i) => (
                    <div key={i} className="danger-zone-item">
                      <strong>{dz.preset}</strong>
                      <p className="danger-risk">{dz.risk}</p>
                      <p className="danger-safe">{dz.safe_usage}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* ═══ SAVE BAR ═══ */}
            <div className="save-bar">
              <div className="filename-row">
                <label className="filename-label">Save as:</label>
                <input
                  type="text"
                  className="filename-input"
                  value={filename}
                  onChange={e => setFilename(e.target.value)}
                />
                <span className="filename-ext">.jpg</span>
              </div>

              <button
                className="btn btn-primary btn-large save-btn"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? 'Processing...'
                  : hasEdits
                    ? 'Save to Processed'
                    : 'Save Original to Processed'
                }
              </button>
            </div>

            {status && (
              <div className={`action-status ${
                status.type === 'success' ? 'action-success'
                  : status.type === 'error' ? 'action-error'
                    : 'action-info'
              }`}>
                {status.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  async function handleSave() {
    setSaving(true)
    setStatus(null)
    try {
      const hasCrop = appliedCrop && !(appliedCrop.x === 0 && appliedCrop.y === 0 && appliedCrop.w === 100 && appliedCrop.h === 100)
      const res = await processPhoto(photo.id, {
        rotate: true,
        crop: hasCrop ? appliedCrop : null,
        adjustments: appliedAdjustments,
        upscale: upscaleApplied,
        output_filename: filename || null,
      })
      setStatus({ type: 'success', message: `Saved as ${res.filename}` })
    } catch (err) {
      setStatus({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value ?? '—'}</span>
    </div>
  )
}

export default PhotoDetail
