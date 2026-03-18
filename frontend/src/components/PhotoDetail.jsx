import { useState, useEffect, useCallback, useRef } from 'react'
import CropEditor from './CropEditor'
import {
  processPhoto,
  previewPhotoUrl,
  getPresetRecommendation,
  getCropOptions,
  upscalePreviewUrl,
  blurPreviewUrl,
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
    'Enhance this portrait photo to professional quality. Preserve 100% of the original ' +
    'identity — face structure, expression, pose, clothing, and background must remain ' +
    'unchanged. Recover fine detail: sharp facial features, natural skin texture with ' +
    'visible pores, realistic hair strands, and clean edges. Apply balanced cinematic ' +
    'lighting with improved dynamic range — lift shadows slightly, recover highlights, ' +
    'without relighting or reshaping. Remove compression artifacts and digital noise. ' +
    'Apply controlled sharpening. Do NOT smooth skin artificially, do NOT alter facial ' +
    'anatomy, do NOT change colors dramatically. Output should read as a true-to-life ' +
    'photorealistic enhancement — the same photo, only clearer, sharper, and higher ' +
    'resolution.',
}

const PRESET_FILTERS = {
  'Adaptive: Subject > Warm Pop': 'brightness(1.06) saturate(1.25) sepia(0.18) contrast(1.05)',
  'Adaptive: Subject > Light': 'brightness(1.2) contrast(0.92) saturate(1.05)',
  'Adaptive: Subject > Vibrant': 'saturate(1.4) contrast(1.08) brightness(1.03)',
  'Adaptive: Subject > Warm Light': 'brightness(1.12) saturate(1.12) sepia(0.14) contrast(0.98)',
  'Adaptive: Subject > Pop': 'brightness(1.1) contrast(1.18) saturate(1.1)',
  'Adaptive: Subject > Balance Contrast': 'brightness(1.02) contrast(1.12) saturate(1.0)',
  'Adaptive: Portrait > Polished Portrait': 'brightness(1.04) contrast(1.04) saturate(1.04)',
  'Adaptive: Portrait > Enhance Portrait': 'brightness(1.1) contrast(1.1) saturate(1.08) hue-rotate(2deg)',
  'Adaptive: Portrait > Smooth Facial Skin': 'brightness(1.02) contrast(0.95) saturate(1.0) blur(0.5px)',
  'Adaptive: Blur Background > Subtle': null,
  'Style: Cinematic': 'brightness(0.93) contrast(1.22) saturate(0.82) sepia(0.06) hue-rotate(-5deg)',
  'Portraits: Black & White': 'grayscale(1) contrast(1.18) brightness(1.04)',
  'Portraits: Group': 'brightness(1.05) contrast(1.06) saturate(1.06)',
  'Adaptive: Sky > Blue Pop': 'saturate(1.3) contrast(1.1) brightness(1.02) hue-rotate(-8deg)',
}

const BLUR_PRESET_NAME = 'Adaptive: Blur Background > Subtle'

function getFilterForPreset(presetName) {
  if (presetName in PRESET_FILTERS) return PRESET_FILTERS[presetName]
  const lower = presetName.toLowerCase()
  if (lower.includes('warm')) return 'brightness(1.08) saturate(1.15) sepia(0.12)'
  if (lower.includes('cinematic') || lower.includes('moody')) return 'brightness(0.95) contrast(1.2) saturate(0.85)'
  if (lower.includes('b&w') || lower.includes('black')) return 'grayscale(1) contrast(1.15)'
  if (lower.includes('vibrant') || lower.includes('pop')) return 'brightness(1.05) contrast(1.12) saturate(1.25)'
  if (lower.includes('light') || lower.includes('bright')) return 'brightness(1.12) contrast(0.95)'
  return 'brightness(1.05) contrast(1.05) saturate(1.08)'
}

function PhotoDetail({ photo, result, runId, onClose, onPrev, onNext }) {
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

  // Clean up step timers when the modal unmounts
  useEffect(() => {
    return () => {
      stepTimers.current.forEach(t => clearTimeout(t))
    }
  }, [])

  // Keyboard navigation: Escape closes, arrows navigate prev/next
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, onPrev, onNext])

  // Compare mode: 'original' | 'clarity' | 'enhance'
  const [viewMode, setViewMode] = useState('enhance')
  const [claritySrc, setClaritySrc] = useState(null)
  const [enhanceSrc, setEnhanceSrc] = useState(null)
  const [selectedUpscaleForSave, setSelectedUpscaleForSave] = useState(null)

  const [presetPreviewFilter, setPresetPreviewFilter] = useState(null)
  const [blurPreviewSrc, setBlurPreviewSrc] = useState(null)
  const [blurPreviewLoading, setBlurPreviewLoading] = useState(false)

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

  async function applyCompareBoth() {
    setUpscaleLoading(true)
    setUpscaleStep('Running Clarity and Enhance in parallel...')
    setStatus(null)
    setUpscaleSrc(null)
    setClaritySrc(null)
    setEnhanceSrc(null)

    stepTimers.current.forEach(t => clearTimeout(t))
    stepTimers.current = UPSCALE_STEPS.slice(1).map(step =>
      setTimeout(() => setUpscaleStep(step.text), step.at)
    )

    const hasCrop = appliedCrop && !(appliedCrop.x === 0 && appliedCrop.y === 0 && appliedCrop.w === 100 && appliedCrop.h === 100)
    const opts = { crop: hasCrop ? appliedCrop : null, adjustments: appliedAdjustments }

    try {
      const [clarityUrl, enhanceUrl] = await Promise.all([
        upscalePreviewUrl(photo.id, { ...opts, mode: 'clarity' }),
        upscalePreviewUrl(photo.id, { ...opts, mode: 'enhance' }),
      ])
      setClaritySrc(clarityUrl)
      setEnhanceSrc(enhanceUrl)
      setUpscaleApplied(true)
      setViewMode('enhance')
      setSelectedUpscaleForSave('enhance')
      setStatus({
        type: 'success',
        message: 'Both modes ready — click Original / Clarity / Full Enhance to compare.',
      })
    } catch (err) {
      setStatus({ type: 'error', message: `Compare failed: ${err.message}` })
    } finally {
      stepTimers.current.forEach(t => clearTimeout(t))
      stepTimers.current = []
      setUpscaleLoading(false)
      setUpscaleStep('')
    }
  }

  async function applyUpscale() {
    setUpscaleLoading(true)
    setUpscaleStep(UPSCALE_STEPS[0].text)
    setStatus(null)
    setClaritySrc(null)
    setEnhanceSrc(null)

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
      setViewMode(upscaleMode)
      setSelectedUpscaleForSave(upscaleMode)
      setStatus({
        type: 'success',
        message: `Enhancement applied (${upscaleMode === 'clarity' ? 'Clarity Only' : 'Full Enhance'}).`,
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
    setClaritySrc(null)
    setEnhanceSrc(null)
    setViewMode('enhance')
    setSelectedUpscaleForSave(null)
    setStatus(null)
  }

  // Pick the right image source for the main view
  function _getMainSrc() {
    if (!upscaleApplied) return previewSrc || originalSrc
    if (viewMode === 'original') return previewSrc || originalSrc
    if (viewMode === 'clarity') return claritySrc || upscaleSrc || previewSrc || originalSrc
    if (viewMode === 'enhance') return enhanceSrc || upscaleSrc || previewSrc || originalSrc
    return previewSrc || originalSrc
  }

  const mainSrc = _getMainSrc()
  const hasEdits = !!appliedCrop || !!appliedAdjustments || upscaleApplied
  const hasBothModes = !!(claritySrc && enhanceSrc)

  if (!result) {
    return (
      <div className="photo-detail-overlay" onClick={onClose}>
        <div className="photo-detail" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <div className="detail-nav">
            {onPrev && <button className="detail-nav-btn" onClick={onPrev} title="Previous photo (←)">←</button>}
            {onNext && <button className="detail-nav-btn" onClick={onNext} title="Next photo (→)">→</button>}
          </div>
          <h2>{photo.filename}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
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
          <div className="detail-nav">
            {onPrev && <button className="detail-nav-btn" onClick={onPrev} title="Previous photo (←)">←</button>}
            {onNext && <button className="detail-nav-btn" onClick={onNext} title="Next photo (→)">→</button>}
          </div>
          <h2 className="detail-title">{photo.filename}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
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
                <img
                  src={presetPreviewFilter === '__blur__' ? (blurPreviewSrc || mainSrc) : mainSrc}
                  alt={photo.filename}
                  style={presetPreviewFilter && presetPreviewFilter !== '__blur__' ? { filter: presetPreviewFilter } : undefined}
                />
              </div>
            )}

            <div className="photo-controls-bar">
              {/* View mode toggle buttons — shown when upscale has been applied */}
              {upscaleApplied && !cropMode && (
                <div className="view-mode-bar">
                  <button
                    className={`view-mode-btn ${viewMode === 'original' ? 'view-mode-btn-active' : ''}`}
                    onClick={() => setViewMode('original')}
                  >
                    Original
                  </button>
                  {/* Only show Clarity button if clarity result exists, or single-mode was clarity */}
                  {(claritySrc || (upscaleSrc && selectedUpscaleForSave === 'clarity')) && (
                    <button
                      className={`view-mode-btn ${viewMode === 'clarity' ? 'view-mode-btn-active' : ''}`}
                      onClick={() => {
                        setViewMode('clarity')
                        setSelectedUpscaleForSave('clarity')
                      }}
                    >
                      Clarity
                    </button>
                  )}
                  {/* Only show Full Enhance button if enhance result exists, or single-mode was enhance */}
                  {(enhanceSrc || (upscaleSrc && selectedUpscaleForSave === 'enhance')) && (
                    <button
                      className={`view-mode-btn ${viewMode === 'enhance' ? 'view-mode-btn-active' : ''}`}
                      onClick={() => {
                        setViewMode('enhance')
                        setSelectedUpscaleForSave('enhance')
                      }}
                    >
                      Full Enhance
                    </button>
                  )}
                  {hasBothModes && (
                    <span className="view-mode-hint">Click to compare — selected version will be saved</span>
                  )}
                </div>
              )}

              {hasEdits && !cropMode && (
                <div className="preview-badge">
                  {[
                    appliedCrop && 'Cropped',
                    appliedAdjustments && 'Styled',
                    upscaleApplied && (viewMode === 'original' ? 'Viewing Original' : viewMode === 'clarity' ? 'Clarity' : 'Full Enhance'),
                  ].filter(Boolean).join(' + ')}
                </div>
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
                    const isBlurPreset = p.name === BLUR_PRESET_NAME
                    const cssFilter = isBlurPreset ? null : getFilterForPreset(p.name)
                    const isPreviewActive = presetPreviewFilter === cssFilter && cssFilter !== null
                    const isBlurActive = isBlurPreset && presetPreviewFilter === '__blur__'

                    return (
                      <div key={rec.id || i} className={`preset-card ${i === 0 ? 'preset-card-primary' : ''}`}>
                        <div className="preset-card-rank">#{i + 1}</div>
                        <div className="preset-card-preview">
                          {isBlurPreset && blurPreviewSrc ? (
                            <img src={blurPreviewSrc} alt={`Preview: ${p.name}`} />
                          ) : (
                            <img
                              src={photo.thumbnail_url || originalSrc}
                              alt={`Preview: ${p.name}`}
                              style={cssFilter ? { filter: cssFilter } : undefined}
                            />
                          )}
                          {isBlurPreset && blurPreviewLoading && (
                            <div className="preset-card-blur-loading">Generating AI preview...</div>
                          )}
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

                          {isBlurPreset ? (
                            <button
                              className={`btn btn-small preset-preview-full-btn ${isBlurActive ? 'btn-primary' : ''}`}
                              disabled={blurPreviewLoading}
                              onClick={async () => {
                                if (isBlurActive) {
                                  setPresetPreviewFilter(null)
                                  return
                                }
                                if (blurPreviewSrc) {
                                  setPresetPreviewFilter('__blur__')
                                  return
                                }
                                setBlurPreviewLoading(true)
                                try {
                                  const url = await blurPreviewUrl(photo.id)
                                  setBlurPreviewSrc(url)
                                  setPresetPreviewFilter('__blur__')
                                } catch {
                                  // silently fail — leave thumbnail as is
                                } finally {
                                  setBlurPreviewLoading(false)
                                }
                              }}
                            >
                              {blurPreviewLoading ? 'Generating...' : isBlurActive ? '✓ Viewing AI blur' : 'Generate AI blur preview'}
                            </button>
                          ) : (
                            <button
                              className={`btn btn-small preset-preview-full-btn ${isPreviewActive ? 'btn-primary' : ''}`}
                              onClick={() => {
                                if (isPreviewActive) {
                                  setPresetPreviewFilter(null)
                                } else {
                                  setPresetPreviewFilter(cssFilter)
                                }
                              }}
                            >
                              {isPreviewActive ? '✓ Previewing full' : 'Preview on full image'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  <details className="preset-proof-section">
                    <summary>How we know this preview is accurate (proof)</summary>
                    <div className="preset-proof-content">
                      <p><strong>Evidence &amp; Avoid are from real Lightroom presets.</strong> The &quot;Why&quot; and &quot;Avoid&quot; text comes from our research-backed preset library (<code>production_preset_recommendations.yml</code>), which maps photo metadata (lighting, scene, face visibility) to Adobe Lightroom Adaptive presets.</p>
                      <p><strong>CSS filters are approximations.</strong> Lightroom uses AI masking and per-pixel adjustments. Our preview uses CSS filters (brightness, contrast, saturation, etc.) to approximate the visual effect. It gives you a rough idea — the actual preset in Lightroom will look more refined.</p>
                      <p><strong>The recommendation is accurate.</strong> The preset name, path, evidence, and avoid guidance are based on dating-photo research (Photofeeler, Hinge, OkCupid). The visual preview is our best CSS approximation of that preset&apos;s look.</p>
                    </div>
                  </details>
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
                    <>
                      <button className="btn btn-small btn-primary" onClick={applyUpscale}>
                        Apply {upscaleMode === 'clarity' ? 'Clarity' : 'Enhance'}
                      </button>
                      <button className="btn btn-small btn-accent" onClick={applyCompareBoth}>
                        Compare Both
                      </button>
                    </>
                  )}
                  {upscaleApplied && (
                    <>
                      <span className="edit-applied-tag">
                        {hasBothModes ? 'Compare mode' : 'Applied'}
                      </span>
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
                <details className="upscale-details">
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
                  ? 'Saving...'
                  : hasEdits
                    ? 'Save Photo'
                    : 'Save Original'
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
      const modeToSave = upscaleApplied ? (selectedUpscaleForSave || viewMode || upscaleMode) : null
      const res = await processPhoto(photo.id, {
        rotate: true,
        crop: hasCrop ? appliedCrop : null,
        adjustments: appliedAdjustments,
        upscale: upscaleApplied,
        upscale_mode: modeToSave,
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
