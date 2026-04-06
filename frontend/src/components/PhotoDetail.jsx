import { useState, useEffect, useCallback, useRef } from 'react'
import CropEditor from './CropEditor'
import {
  processPhoto,
  previewPhotoUrl,
  getPresetRecommendation,
  getCropOptions,
  upscalePreviewUrl,
  blurPreviewUrl,
  rotatePhotoManual,
} from '../api/client'

function revokeObjectUrlSafe(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}

const PROMPTS = {
  hd_restore:
    'This is a low-quality video frame or screenshot with compression blocking, motion blur, ' +
    'pixelation, or low bitrate artefacts. Your ONLY task is pure technical AI super-resolution ' +
    'restoration — no creative changes whatsoever.\n\n' +
    'WHAT TO DO:\n' +
    '- AI super-resolution: reconstruct missing high-frequency detail lost to video compression or downsampling\n' +
    '- Remove JPEG/video blocking artefacts: eliminate the blocky 8×8 pixel grid from DCT video codecs (H.264, H.265)\n' +
    '- Remove motion blur and temporal smearing from low frame rate or video encoding\n' +
    '- Remove interlacing lines or comb artefacts if present\n' +
    '- Reconstruct sharp edges, crisp detail, defined features — whatever was lost to compression\n' +
    '- Output should look like the same frame from a high-bitrate 4K source\n\n' +
    'FORBIDDEN — change absolutely nothing else:\n' +
    '- No colour changes, no tone adjustments, no brightness or contrast changes\n' +
    '- No face changes, no beauty filters, no skin smoothing\n' +
    '- No background blur, no vignette, no photographic effects\n' +
    '- No invented detail — only reconstruct what was genuinely there but lost',
  clarity:
    'Sharpen and clarify this photo so it looks like it was taken with a higher-quality camera — ' +
    'without any detectable AI processing.\n\n' +
    'WHAT TO DO:\n' +
    '- Apply deconvolution-style sharpening to recover edge definition and micro-detail lost to lens softness or camera shake\n' +
    '- Reduce digital noise and compression artifacts while preserving genuine film-like texture\n' +
    '- Increase perceived resolution — the photo should look like it was shot on a Sony A7 IV or Canon R5 at f/2.8, ISO 100\n' +
    '- Recover fine detail: individual hair strands, fabric weave, skin pores, eyelashes, background texture\n' +
    '- Improve local contrast and micro-contrast so edges appear crisply defined\n' +
    '- Preserve the exact same colours, white balance, exposure, and mood\n\n' +
    'FORBIDDEN: No AI smoothing, no face changes, no background changes, no colour grading, no halos.',
  enhance:
    'Enhance this portrait photo to professional quality. Preserve 100% of the original ' +
    'identity — face structure, expression, pose, clothing, and background must remain ' +
    'unchanged. Recover fine detail: sharp facial features, natural skin texture with ' +
    'visible pores, realistic hair strands, and clean edges. Apply balanced cinematic ' +
    'lighting with improved dynamic range — lift shadows slightly, recover highlights, ' +
    'without relighting or reshaping. Remove compression artifacts and digital noise. ' +
    'Apply controlled sharpening. Do NOT smooth skin artificially, do NOT alter facial ' +
    'anatomy, do NOT change colors dramatically. Output: the same photo, only clearer, ' +
    'sharper, and higher resolution.',
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
  if (lower.includes('vibrant')) return 'brightness(1.03) contrast(1.08) saturate(1.12)'
  if (lower.includes('pop')) return 'brightness(1.04) contrast(1.08) saturate(1.03)'
  if (lower.includes('light') || lower.includes('bright')) return 'brightness(1.12) contrast(0.95)'
  return 'brightness(1.05) contrast(1.05) saturate(1.08)'
}

function PhotoDetail({ photo, result, runId, onClose, onPrev, onNext, isShortlisted, onShortlist, isArchived, onArchive, processedFilename }) {
  const [previewSrc, setPreviewSrc] = useState(null)
  const [rotating, setRotating] = useState(false)
  const [rotationKey, setRotationKey] = useState(0)

  const originalSrc = `/api/photos/${photo.id}/full${rotationKey ? `?v=${rotationKey}` : ''}`

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

  const [aiLoading, setAiLoading] = useState(false)
  const [claritySrc, setClaritySrc] = useState(null)
  const [enhanceSrc, setEnhanceSrc] = useState(null)
  const [aiStep, setAiStep] = useState('')
  const [aiProgressPct, setAiProgressPct] = useState(null)
  const monotonicRef = useRef(null)

  function clearMonotonic() {
    if (monotonicRef.current != null) {
      clearInterval(monotonicRef.current)
      monotonicRef.current = null
    }
  }

  useEffect(() => {
    return () => clearMonotonic()
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

  // Compare: 'original' | 'clarity' | 'enhance'
  const [viewMode, setViewMode] = useState('original')

  const aiBlobsRef = useRef({ clarity: null, enhance: null })
  aiBlobsRef.current = { clarity: claritySrc, enhance: enhanceSrc }

  const [presetPreviewFilter, setPresetPreviewFilter] = useState(null)
  const [blurPreviewSrc, setBlurPreviewSrc] = useState(null)
  const [blurPreviewLoading, setBlurPreviewLoading] = useState(false)

  const [appliedAdjustments, setAppliedAdjustments] = useState(null)
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  // New photo → reset AI UI; cleanup revokes latest blob URLs via ref (avoids stale closures).
  useEffect(() => {
    setClaritySrc(null)
    setEnhanceSrc(null)
    setViewMode('original')
    setAiProgressPct(null)
    setAiStep('')
    clearMonotonic()
    return () => {
      const { clarity, enhance } = aiBlobsRef.current
      revokeObjectUrlSafe(clarity)
      revokeObjectUrlSafe(enhance)
    }
  }, [photo.id])

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
    // Crop / style changed → AI previews are no longer valid; clear without forcing user to “revert” manually.
    setClaritySrc((u) => { revokeObjectUrlSafe(u); return null })
    setEnhanceSrc((u) => { revokeObjectUrlSafe(u); return null })
    setViewMode('original')
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

  const AI_MODE_LABELS = { clarity: 'Clarity', enhance: 'Full Enhance' }

  async function tryAiPreview(mode) {
    const setter = mode === 'clarity' ? setClaritySrc : setEnhanceSrc
    const label = AI_MODE_LABELS[mode]
    setAiLoading(true)
    setAiProgressPct(0)
    setAiStep(`Sending to Gemini ${label}…`)
    setStatus(null)
    clearMonotonic()

    const hasCrop = appliedCrop && !(appliedCrop.x === 0 && appliedCrop.y === 0 && appliedCrop.w === 100 && appliedCrop.h === 100)
    const opts = { crop: hasCrop ? appliedCrop : null, adjustments: appliedAdjustments }

    try {
      const url = await upscalePreviewUrl(photo.id, {
        ...opts,
        mode,
        onProgress: (p) => {
          setAiProgressPct(p)
          setAiStep(p >= 100 ? '100% — Done' : `${p}% — Gemini processing…`)
        },
      })
      setter(url)
      setViewMode(mode)
      setAiProgressPct(100)
      setAiStep(`Done — ${label} complete`)
      setStatus({
        type: 'success',
        message: `${label} preview ready. Click "Save" to save this version to processed/.`,
      })
    } catch (err) {
      setStatus({ type: 'error', message: `${label} failed: ${err.message}` })
    } finally {
      clearMonotonic()
      setAiLoading(false)
      setAiProgressPct(null)
      setAiStep('')
    }
  }

  function clearAiPreviews() {
    revokeObjectUrlSafe(claritySrc)
    revokeObjectUrlSafe(enhanceSrc)
    setClaritySrc(null)
    setEnhanceSrc(null)
    setViewMode('original')
    setStatus(null)
    clearMonotonic()
    setAiProgressPct(null)
    setAiStep('')
  }

  async function handleSave() {
    setSaving(true)
    setStatus(null)
    try {
      const hasCrop = appliedCrop && !(appliedCrop.x === 0 && appliedCrop.y === 0 && appliedCrop.w === 100 && appliedCrop.h === 100)
      const aiActive = viewMode !== 'original' && (claritySrc || enhanceSrc)
      const res = await processPhoto(photo.id, {
        rotate: true,
        crop: hasCrop ? appliedCrop : null,
        adjustments: appliedAdjustments,
        upscale: !!aiActive,
        upscale_mode: aiActive ? viewMode : null,
        output_filename: filename || null,
      })
      setStatus({ type: 'success', message: `Saved as ${res.filename}` })
    } catch (err) {
      setStatus({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }

  // Pick the right image source for the main view
  function _getMainSrc() {
    const base = previewSrc || originalSrc
    if (viewMode === 'clarity' && claritySrc) return claritySrc
    if (viewMode === 'enhance' && enhanceSrc) return enhanceSrc
    return base
  }

  const mainSrc = _getMainSrc()
  const isAiAvailable = !!(claritySrc || enhanceSrc)
  const hasEdits = !!appliedCrop || !!appliedAdjustments || isAiAvailable

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
          <div className="detail-header-actions">
            {onShortlist && (
              <button
                className={`detail-shortlist-btn ${isShortlisted ? 'detail-shortlist-btn-active' : ''}`}
                onClick={e => { e.stopPropagation(); onShortlist(photo.id) }}
                title={isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
              >
                ★ {isShortlisted ? 'Shortlisted' : 'Shortlist'}
              </button>
            )}
            {onArchive && (
              <button
                className={`detail-archive-btn ${isArchived ? 'detail-archive-btn-active' : ''}`}
                onClick={e => { e.stopPropagation(); onArchive(photo.id) }}
                title={isArchived ? 'Restore from archive' : 'Archive (hide from Photos)'}
              >
                {isArchived ? '↩ Restore' : '⊘ Archive'}
              </button>
            )}
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
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
          <div className="detail-header-actions">
            {onShortlist && (
              <button
                className={`detail-shortlist-btn ${isShortlisted ? 'detail-shortlist-btn-active' : ''}`}
                onClick={e => { e.stopPropagation(); onShortlist(photo.id) }}
                title={isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
              >
                ★ {isShortlisted ? 'Shortlisted' : 'Shortlist'}
              </button>
            )}
            {onArchive && (
              <button
                className={`detail-archive-btn ${isArchived ? 'detail-archive-btn-active' : ''}`}
                onClick={e => { e.stopPropagation(); onArchive(photo.id) }}
                title={isArchived ? 'Restore from archive' : 'Archive (hide from Photos)'}
              >
                {isArchived ? '↩ Restore' : '⊘ Archive'}
              </button>
            )}
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
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
              {!cropMode && (
                <div className="view-mode-bar view-mode-bar-ai">
                  <button
                    type="button"
                    className={`view-mode-btn ${viewMode === 'original' ? 'view-mode-btn-active' : ''}`}
                    onClick={() => setViewMode('original')}
                    title="Original photo"
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${viewMode === 'clarity' ? 'view-mode-btn-active' : ''}`}
                    onClick={() => claritySrc ? setViewMode('clarity') : tryAiPreview('clarity')}
                    disabled={aiLoading}
                    title="Clarity — AI sharpening and detail recovery"
                  >
                    {aiLoading && !claritySrc && viewMode !== 'enhance' ? 'Loading…' : claritySrc ? 'Clarity' : '+ Clarity'}
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${viewMode === 'enhance' ? 'view-mode-btn-active' : ''}`}
                    onClick={() => enhanceSrc ? setViewMode('enhance') : tryAiPreview('enhance')}
                    disabled={aiLoading}
                    title="Full Enhance — professional portrait enhancement"
                  >
                    {aiLoading && !enhanceSrc && viewMode !== 'clarity' ? 'Loading…' : enhanceSrc ? 'Full Enhance' : '+ Full Enhance'}
                  </button>
                  {isAiAvailable && (
                    <button
                      type="button"
                      className="view-mode-btn view-mode-btn-clear"
                      onClick={clearAiPreviews}
                      title="Clear AI previews and return to original"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {aiLoading && (
                <div className="ai-progress-inline">
                  <div className="upscale-spinner" />
                  <span>{aiStep}</span>
                </div>
              )}

              {hasEdits && !cropMode && (
                <div className="preview-badge">
                  {[
                    appliedCrop && 'Cropped',
                    appliedAdjustments && 'Styled',
                    isAiAvailable && (viewMode === 'original' ? 'AI Ready (viewing original)' : AI_MODE_LABELS[viewMode]),
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
                      <p><strong>Recommendations follow your analysis metadata</strong> (scene, lighting, quality, colors). If metadata is off, try re-analysing the photo. The visual preview is a deliberately mild CSS hint — real Lightroom Adaptive presets use local adjustments and often look less heavy than a global filter.</p>
                    </div>
                  </details>
                </>
              ) : (
                <p className="muted">No preset recommendations available.</p>
              )}
            </div>

            {/* ═══ ROTATE ═══ */}
            <div className="edit-section">
              <div className="edit-section-header">
                <h3>Rotate</h3>
                <div className="edit-section-actions">
                  <button
                    className="btn btn-small"
                    disabled={rotating}
                    onClick={async () => {
                      setRotating(true)
                      try {
                        await rotatePhotoManual(photo.id, 90)
                        setRotationKey(k => k + 1)
                        setPreviewSrc(null)
                        setStatus({ type: 'info', message: 'Rotated 90° clockwise. Image saved.' })
                      } catch (e) {
                        setStatus({ type: 'error', message: `Rotate failed: ${e.message}` })
                      } finally { setRotating(false) }
                    }}
                  >
                    {rotating ? '...' : '↻ 90° CW'}
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={rotating}
                    onClick={async () => {
                      setRotating(true)
                      try {
                        await rotatePhotoManual(photo.id, 270)
                        setRotationKey(k => k + 1)
                        setPreviewSrc(null)
                        setStatus({ type: 'info', message: 'Rotated 90° counter-clockwise. Image saved.' })
                      } catch (e) {
                        setStatus({ type: 'error', message: `Rotate failed: ${e.message}` })
                      } finally { setRotating(false) }
                    }}
                  >
                    {rotating ? '...' : '↺ 90° CCW'}
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={rotating}
                    onClick={async () => {
                      setRotating(true)
                      try {
                        await rotatePhotoManual(photo.id, 180)
                        setRotationKey(k => k + 1)
                        setPreviewSrc(null)
                        setStatus({ type: 'info', message: 'Rotated 180°. Image saved.' })
                      } catch (e) {
                        setStatus({ type: 'error', message: `Rotate failed: ${e.message}` })
                      } finally { setRotating(false) }
                    }}
                  >
                    {rotating ? '...' : '↕ 180°'}
                  </button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.78rem', padding: '4px 0' }}>
                Rotation is saved directly to the file. Thumbnail updates automatically.
              </p>
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
                type="button"
                className="btn btn-primary btn-large save-btn"
                onClick={handleSave}
                disabled={saving || aiLoading}
                title={aiLoading ? 'Wait for AI previews to finish' : undefined}
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
