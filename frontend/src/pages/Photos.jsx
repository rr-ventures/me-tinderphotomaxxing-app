import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { listRuns, getRun, listPhotos, addToSaved, getSaved, getShortlist, addToShortlist, removeFromShortlist, downloadRunPhotos, archivePhotos, unarchivePhotos, getArchivedIds, getMergedRun, batchEnhance, getBatchEnhanceProgress, getRunPresetRecommendations, downloadProcessedPhotos } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

const QUALITY_OPTIONS = [
  { value: '', label: 'All quality' },
  { value: '8', label: '8–10 High' },
  { value: '6', label: '6–7 Medium' },
  { value: '0', label: '1–5 Low' },
]

const COST_PER_PHOTO = 0.04

function Photos() {
  const [runs, setRuns] = useState([])
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [run, setRun] = useState(null)
  const [photos, setPhotos] = useState([])
  const [savedIds, setSavedIds] = useState(new Set())
  const [shortlistIds, setShortlistIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)

  const [archivedIds, setArchivedIds] = useState(new Set())
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filterStyle, setFilterStyle] = useState('')
  const [filterQuality, setFilterQuality] = useState('')
  const [filterPreset, setFilterPreset] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadingProcessed, setDownloadingProcessed] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

  // Upscale modal state
  const [upscaleModal, setUpscaleModal] = useState(null) // null | 'confirm' | 'running' | 'done' | 'error'
  const [upscaleIds, setUpscaleIds] = useState([])
  const [upscaleProgress, setUpscaleProgress] = useState(null)
  const [upscaleJobId, setUpscaleJobId] = useState(null)
  const pollRef = useRef(null)
  // Tracks whether a job has ever completed this session (so we can show a banner)
  const [upscaleDoneCount, setUpscaleDoneCount] = useState(null)

  // Preset modal
  const [showPresetModal, setShowPresetModal] = useState(false)
  const [presetData, setPresetData] = useState(null)
  const [presetLoading, setPresetLoading] = useState(false)
  const [presetCopied, setPresetCopied] = useState(false)

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const [runsData, savedData, slData, archData] = await Promise.all([listRuns(), getSaved(), getShortlist(), getArchivedIds()])
        const allRuns = runsData.runs || []
        setRuns(allRuns)
        setSavedIds(new Set(savedData.photo_ids || []))
        setShortlistIds(new Set(slData.photo_ids || []))
        setArchivedIds(new Set(archData.photo_ids || []))
        if (allRuns.length > 0) {
          setSelectedRunId(allRuns[0].run_id)
        } else {
          setLoading(false)
        }
      } catch (err) {
        setError(err.message)
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedRunId) return
    async function loadRun() {
      setLoading(true)
      setError(null)
      setSelectedIds(new Set())
      try {
        if (selectedRunId === 'all') {
          const [runData, photoData] = await Promise.all([getMergedRun(), listPhotos()])
          setRun(runData)
          setPhotos(photoData.photos || [])
        } else {
          const [runData, photoData] = await Promise.all([getRun(selectedRunId), listPhotos(selectedRunId)])
          setRun(runData)
          setPhotos(photoData.photos || [])
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadRun()
  }, [selectedRunId])

  // Poll upscale progress
  useEffect(() => {
    if (!upscaleJobId) return
    function stop() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
    pollRef.current = setInterval(async () => {
      try {
        const prog = await getBatchEnhanceProgress(upscaleJobId)
        setUpscaleProgress(prog)
        if (prog.status === 'done' || prog.status === 'error') {
          stop()
          setUpscaleModal('done')
          if (prog.status === 'done') setUpscaleDoneCount(prog.results?.length || 0)
        }
      } catch { /* keep polling */ }
    }, 2000)
    return stop
  }, [upscaleJobId])

  const results = run?.results || []

  const resultByFilename = useMemo(() => {
    const map = {}
    results.forEach(r => { map[r.filename] = r })
    return map
  }, [results])

  const uniqueStyles = useMemo(() => [...new Set(results.map(r => r.primary_style).filter(Boolean))].sort(), [results])
  const uniquePresets = useMemo(() => [...new Set(results.map(r => r.preset_recommendation?.preset?.name).filter(Boolean))].sort(), [results])

  const filteredPhotos = useMemo(() => {
    let base = photos
    if (filterStyle) {
      const fnames = new Set(results.filter(r => r.primary_style === filterStyle).map(r => r.filename))
      base = base.filter(p => fnames.has(p.filename))
    }
    if (filterPreset) {
      const fnames = new Set(results.filter(r => r.preset_recommendation?.preset?.name === filterPreset).map(r => r.filename))
      base = base.filter(p => fnames.has(p.filename))
    }
    if (filterQuality) {
      const q = parseInt(filterQuality)
      base = base.filter(p => {
        const score = resultByFilename[p.filename]?.metadata?.photo_quality
        if (score == null) return false
        if (q === 8) return score >= 8
        if (q === 6) return score >= 6 && score < 8
        if (q === 0) return score < 6
        return true
      })
    }
    return base
  }, [photos, filterStyle, filterPreset, filterQuality, results, resultByFilename])

  const hasActiveFilters = !!(filterStyle || filterPreset || filterQuality)

  const handlePhotoClick = useCallback((photo, result) => {
    setSelectedPhoto(photo)
    setSelectedResult(result || resultByFilename[photo.filename] || null)
  }, [resultByFilename])

  const handlePhotoNav = useCallback((direction) => {
    setSelectedPhoto(prev => {
      if (!prev) return prev
      const idx = filteredPhotos.findIndex(p => p.id === prev.id)
      const next = filteredPhotos[idx + direction]
      if (!next) return prev
      setSelectedResult(resultByFilename[next.filename] || null)
      return next
    })
  }, [filteredPhotos, resultByFilename])

  const toggleSelection = useCallback((photoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId)
      return next
    })
  }, [])

  const handleToggleShortlist = useCallback(async (photoId) => {
    try {
      if (shortlistIds.has(photoId)) {
        await removeFromShortlist([photoId])
        setShortlistIds(prev => { const n = new Set(prev); n.delete(photoId); return n })
      } else {
        await addToShortlist([photoId], selectedRunId)
        setShortlistIds(prev => new Set([...prev, photoId]))
      }
    } catch { /* silent */ }
  }, [shortlistIds, selectedRunId])

  const handleToggleArchive = useCallback(async (photoId) => {
    try {
      if (archivedIds.has(photoId)) {
        await unarchivePhotos([photoId])
        setArchivedIds(prev => { const n = new Set(prev); n.delete(photoId); return n })
      } else {
        await archivePhotos([photoId])
        setArchivedIds(prev => new Set([...prev, photoId]))
        if (selectedPhoto?.id === photoId) { setSelectedPhoto(null); setSelectedResult(null) }
        setPhotos(prev => prev.filter(p => p.id !== photoId))
      }
    } catch { /* silent */ }
  }, [archivedIds, selectedPhoto])

  async function handleAddToSaved() {
    const ids = [...selectedIds]
    if (!ids.length) return
    setSaving(true)
    setSaveStatus(null)
    try {
      await addToSaved(ids, selectedRunId)
      setSavedIds(prev => new Set([...prev, ...ids]))
      setSelectedIds(new Set())
      setSaveStatus({ type: 'success', message: `${ids.length} photo${ids.length !== 1 ? 's' : ''} added to Saved.` })
    } catch (err) {
      setSaveStatus({ type: 'error', message: `Failed: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  async function handleDownload() {
    setDownloading(true)
    setActionStatus(null)
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : null
      await downloadRunPhotos(selectedRunId, ids, 'analyzed')
    } catch (err) {
      setActionStatus({ type: 'error', message: `Download failed: ${err.message}` })
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadProcessed() {
    setDownloadingProcessed(true)
    try {
      await downloadProcessedPhotos()
    } catch (err) {
      setActionStatus({ type: 'error', message: `Download failed: ${err.message}` })
    } finally {
      setDownloadingProcessed(false)
    }
  }

  async function handleArchive() {
    const ids = [...selectedIds]
    if (!ids.length) return
    setArchiving(true)
    try {
      const res = await archivePhotos(ids)
      setActionStatus({ type: 'success', message: `${res.archived} photo${res.archived !== 1 ? 's' : ''} archived.` })
      setSelectedIds(new Set())
      setArchivedIds(prev => new Set([...prev, ...ids]))
      setPhotos(prev => prev.filter(p => !ids.includes(p.id)))
    } catch (err) {
      setActionStatus({ type: 'error', message: `Archive failed: ${err.message}` })
    } finally {
      setArchiving(false)
    }
  }

  function openUpscaleModal() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : filteredPhotos.map(p => p.id)
    if (!ids.length) return
    setUpscaleIds(ids)
    setUpscaleModal('confirm')
  }

  async function startUpscale() {
    setUpscaleModal('running')
    setUpscaleProgress({ status: 'running', total: upscaleIds.length, completed: 0, errors: 0, log: ['Starting...'], results: [] })
    try {
      const res = await batchEnhance(upscaleIds, {
        runId: selectedRunId !== 'all' ? selectedRunId : null,
        upscaleMode: 'hd_restore',
      })
      setUpscaleJobId(res.job_id)
    } catch (err) {
      setUpscaleModal('error')
      setUpscaleProgress(prev => ({ ...prev, status: 'error', log: [`✗ Failed to start: ${err.message}`] }))
    }
  }

  function closeUpscaleModal() {
    setUpscaleModal(null)
    setUpscaleJobId(null)
  }

  async function openPresetModal() {
    setShowPresetModal(true)
    if (presetData?.runId === selectedRunId) return
    setPresetLoading(true)
    setPresetData(null)
    try {
      const runId = selectedRunId || 'all'
      const data = await getRunPresetRecommendations(runId)
      setPresetData({ ...data, runId })
    } catch (err) {
      setPresetData({ error: err.message, runId: selectedRunId })
    } finally {
      setPresetLoading(false)
    }
  }

  function buildPresetText(photos) {
    if (!photos?.length) return ''
    const lines = ['LIGHTROOM PRESET RECOMMENDATIONS', '================================', `Generated: ${new Date().toLocaleDateString()}`, '']
    photos.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.output_name || p.filename}`)
      if (p.photo_quality != null) lines.push(`   Quality: ${p.photo_quality}/10`)
      if (p.primary_style) lines.push(`   Style: ${p.primary_style.replace(/_/g, ' ')}`)
      ;(p.recommendations || []).forEach((rec, ri) => {
        const name = rec.preset?.name || rec.name || 'Unknown'
        const path = rec.preset?.path ? ` (${rec.preset.path})` : ''
        lines.push(`   ${ri + 1}. ${name}${path}`)
        if (rec.preset?.also_apply) lines.push(`      Also apply: ${rec.preset.also_apply}`)
      })
      lines.push('')
    })
    return lines.join('\n')
  }

  async function copyPresets() {
    await navigator.clipboard.writeText(buildPresetText(presetData?.photos))
    setPresetCopied(true)
    setTimeout(() => setPresetCopied(false), 2500)
  }

  const currentIdx = useMemo(
    () => selectedPhoto ? filteredPhotos.findIndex(p => p.id === selectedPhoto.id) : -1,
    [selectedPhoto, filteredPhotos]
  )

  const upscalePct = upscaleProgress
    ? Math.round(((upscaleProgress.completed || 0) / Math.max(upscaleProgress.total || 1, 1)) * 100)
    : 0

  if (loading) return (
    <div className="loading-page"><div className="loading-spinner" /><p className="muted">Loading photos...</p></div>
  )
  if (runs.length === 0) return (
    <div className="empty-page"><div className="empty-page-icon">📷</div><h2>No analyzed photos yet</h2><p className="muted">Go to Analyze to run your first analysis.</p></div>
  )
  if (error) return (
    <div className="error-page"><h2>Error loading photos</h2><p className="text-error">{error}</p><button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button></div>
  )

  return (
    <div className="photos-page">
      {/* Header */}
      <div className="photos-header">
        <div className="photos-header-left">
          <h1>Photos</h1>
          {run && <span className="photos-count-badge">{filteredPhotos.length} photos</span>}
        </div>
        <div className="photos-header-right">
          {runs.length > 0 && (
            <select className="run-selector" value={selectedRunId || ''} onChange={e => setSelectedRunId(e.target.value)}>
              <option value="all">All runs combined</option>
              {runs.map((r, i) => (
                <option key={r.run_id} value={r.run_id}>{i === 0 ? '★ ' : ''}{r.run_id} ({r.total_analyzed} photos)</option>
              ))}
            </select>
          )}
          <button className="btn btn-small" onClick={openPresetModal}>Lightroom Presets</button>
          <button className="btn btn-primary btn-small" onClick={openUpscaleModal}>
            {upscaleModal === 'running' ? '⏳ Upscaling...' : 'HD Upscale All'}
          </button>
          <button className="btn btn-small" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Zipping...' : selectedIds.size > 0 ? `Download (${selectedIds.size})` : 'Download All'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {saveStatus && (
        <div className={`alert ${saveStatus.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {saveStatus.message}<button onClick={() => setSaveStatus(null)} className="alert-dismiss">✕</button>
        </div>
      )}
      {actionStatus && (
        <div className={`alert ${actionStatus.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {actionStatus.message}<button onClick={() => setActionStatus(null)} className="alert-dismiss">✕</button>
        </div>
      )}

      {/* Upscale status banner */}
      {upscaleModal === 'running' && upscaleProgress && (
        <div className="alert alert-info" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setUpscaleModal('running')}>
          <span style={{ flex: 1 }}>
            ⏳ <strong>HD Upscale running</strong> — {upscaleProgress.completed}/{upscaleProgress.total} photos done
            {upscaleProgress.log?.length > 0 && <span className="muted"> · {upscaleProgress.log[upscaleProgress.log.length - 1]}</span>}
          </span>
          <button className="btn btn-small" onClick={e => { e.stopPropagation(); setUpscaleModal('running') }}>View Progress</button>
        </div>
      )}
      {upscaleDoneCount !== null && upscaleModal !== 'running' && upscaleModal !== 'done' && (
        <div className="alert alert-success" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>
            ✅ <strong>HD Upscale complete</strong> — {upscaleDoneCount} photo{upscaleDoneCount !== 1 ? 's' : ''} upscaled and saved.
          </span>
          <button className="btn btn-primary btn-small" onClick={handleDownloadProcessed} disabled={downloadingProcessed}>
            {downloadingProcessed ? 'Preparing ZIP...' : 'Download Upscaled Photos (ZIP)'}
          </button>
          <button className="btn btn-small" onClick={() => setUpscaleDoneCount(null)}>✕</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <select className="filter-select" value={filterStyle} onChange={e => setFilterStyle(e.target.value)}>
          <option value="">All styles</option>
          {uniqueStyles.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="filter-select" value={filterPreset} onChange={e => setFilterPreset(e.target.value)}>
          <option value="">All presets</option>
          {uniquePresets.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-select" value={filterQuality} onChange={e => setFilterQuality(e.target.value)}>
          {QUALITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hasActiveFilters && (
          <button className="btn btn-small" onClick={() => { setFilterStyle(''); setFilterPreset(''); setFilterQuality('') }}>Clear filters</button>
        )}
        <span className="filter-bar-spacer" />
        <button className="btn btn-small" onClick={() => setSelectedIds(new Set(filteredPhotos.map(p => p.id)))}>Select All</button>
        {selectedIds.size > 0 && (
          <button className="btn btn-small" onClick={() => setSelectedIds(new Set())}>Clear ({selectedIds.size})</button>
        )}
      </div>

      {/* Photo grid */}
      <PhotoGrid
        photos={filteredPhotos}
        results={results}
        onPhotoClick={handlePhotoClick}
        selectable
        selectedIds={selectedIds}
        onSelect={toggleSelection}
        savedIds={savedIds}
        shortlistIds={shortlistIds}
        onShortlist={handleToggleShortlist}
        archivedIds={archivedIds}
        onArchive={handleToggleArchive}
      />

      {/* FAB */}
      {selectedIds.size > 0 && (
        <div className="fab">
          <span className="fab-count">{selectedIds.size} selected</span>
          <div className="fab-divider" />
          <button className="btn btn-primary btn-small" onClick={handleAddToSaved} disabled={saving}>
            {saving ? 'Saving...' : `★ Save (${selectedIds.size})`}
          </button>
          <button className="btn btn-small" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Zipping...' : `Download (${selectedIds.size})`}
          </button>
          <button className="btn btn-danger btn-small" onClick={handleArchive} disabled={archiving}>
            {archiving ? 'Archiving...' : `Archive (${selectedIds.size})`}
          </button>
        </div>
      )}

      {/* Photo detail */}
      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          result={selectedResult}
          runId={selectedRunId}
          onClose={() => { setSelectedPhoto(null); setSelectedResult(null) }}
          onPrev={currentIdx > 0 ? () => handlePhotoNav(-1) : null}
          onNext={currentIdx < filteredPhotos.length - 1 ? () => handlePhotoNav(1) : null}
          isShortlisted={shortlistIds.has(selectedPhoto.id)}
          onShortlist={handleToggleShortlist}
          isArchived={archivedIds.has(selectedPhoto.id)}
          onArchive={handleToggleArchive}
          processedFilename={upscaleProgress?.results?.find(r => r.photo_id === selectedPhoto.id)?.output || null}
        />
      )}

      {/* ── UPSCALE MODAL ── */}
      {upscaleModal && (
        <div className="modal-overlay" onClick={upscaleModal === 'confirm' ? closeUpscaleModal : undefined}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={upscaleModal === 'done' ? { background: 'var(--success-bg, #0d2e1a)', borderBottom: '1px solid var(--success, #22c55e)' } : {}}>
              <h2 style={upscaleModal === 'done' ? { color: '#22c55e' } : {}}>
                {upscaleModal === 'done' ? '✅ HD Upscale Complete!' : 'HD Upscale — Gemini AI'}
              </h2>
              {(upscaleModal === 'confirm' || upscaleModal === 'done' || upscaleModal === 'error') && (
                <button className="modal-close" onClick={closeUpscaleModal}>✕</button>
              )}
            </div>

            {upscaleModal === 'confirm' && (
              <div style={{ padding: '20px 24px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>
                  <strong>{upscaleIds.length} photo{upscaleIds.length !== 1 ? 's' : ''}</strong> will be processed by Gemini AI HD Restore and saved to <code>data/processed/</code>.
                </p>
                <p className="muted" style={{ margin: '0 0 20px', fontSize: '0.85rem' }}>
                  Estimated cost: ~<strong>${(upscaleIds.length * COST_PER_PHOTO).toFixed(2)}</strong> USD &nbsp;·&nbsp;
                  Time: ~{Math.ceil(upscaleIds.length * 20 / 60)} min &nbsp;·&nbsp;
                  {upscaleIds.length} × ~${COST_PER_PHOTO}/photo
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-primary" onClick={startUpscale}>Start Upscale</button>
                  <button className="btn" onClick={closeUpscaleModal}>Cancel</button>
                </div>
              </div>
            )}

            {(upscaleModal === 'running' || upscaleModal === 'done') && upscaleProgress && (
              <div style={{ padding: '16px 24px 20px' }}>
                {/* Progress bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="upscale-progress-bar" style={{ flex: 1 }}>
                    <div className="upscale-progress-fill" style={{ width: `${upscalePct}%` }} />
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {upscaleProgress.completed}/{upscaleProgress.total}
                    {upscaleProgress.errors > 0 ? ` · ${upscaleProgress.errors} errors` : ''}
                    {upscaleModal === 'done' ? ' · Done' : ' · Running...'}
                  </span>
                </div>

                {/* Log */}
                <div className="upscale-log">
                  {(upscaleProgress.log || []).map((line, i) => (
                    <div key={i} className={`upscale-log-line ${line.startsWith('✓') ? 'log-ok' : line.startsWith('✗') ? 'log-err' : 'log-info'}`}>
                      {line}
                    </div>
                  ))}
                </div>

                {/* Done — download button */}
                {upscaleModal === 'done' && (
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
                      {upscaleProgress.results?.length || 0} of {upscaleProgress.total} photos upscaled successfully.
                      {upscaleProgress.errors > 0 && <span style={{ color: '#f87171' }}> {upscaleProgress.errors} failed.</span>}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Files saved to <code>data/processed/</code> — click below to download them all as a ZIP.
                    </p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn btn-primary" style={{ fontSize: '1rem', padding: '10px 20px' }} onClick={handleDownloadProcessed} disabled={downloadingProcessed}>
                        {downloadingProcessed ? '⏳ Preparing ZIP...' : '⬇ Download Upscaled Photos (ZIP)'}
                      </button>
                      <button className="btn" onClick={closeUpscaleModal}>Close</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {upscaleModal === 'error' && upscaleProgress && (
              <div style={{ padding: '16px 24px 20px' }}>
                <div className="alert alert-error" style={{ margin: 0 }}>
                  {upscaleProgress.log?.slice(-1)[0] || 'Unknown error'}
                </div>
                <button className="btn" style={{ marginTop: 12 }} onClick={closeUpscaleModal}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LIGHTROOM PRESETS MODAL ── */}
      {showPresetModal && (
        <div className="modal-overlay" onClick={() => setShowPresetModal(false)}>
          <div className="modal preset-export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Lightroom Preset Recommendations</h2>
              <button className="modal-close" onClick={() => setShowPresetModal(false)}>✕</button>
            </div>

            {presetLoading && (
              <div className="preset-export-loading">
                <div className="loading-spinner" />
                <p className="muted">Loading recommendations...</p>
              </div>
            )}

            {presetData?.error && (
              <div className="alert alert-error" style={{ margin: '16px 24px' }}>{presetData.error}</div>
            )}

            {presetData?.photos && !presetLoading && (
              <>
                <p className="preset-export-intro muted">
                  Top 3 Lightroom preset recommendations for {presetData.photos.length} photos.
                </p>
                <div className="preset-export-actions">
                  <button className="btn btn-primary btn-small" onClick={copyPresets}>
                    {presetCopied ? '✓ Copied!' : 'Copy All to Clipboard'}
                  </button>
                </div>
                <div className="preset-export-list">
                  {presetData.photos.map((p, i) => (
                    <div key={p.image_id || i} className="preset-export-photo">
                      <div className="preset-export-photo-header">
                        <span className="preset-export-filename">{p.output_name || p.filename}</span>
                        {p.photo_quality != null && <span className="preset-export-quality">Quality: {p.photo_quality}/10</span>}
                        {p.primary_style && <span className="preset-export-style">{p.primary_style.replace(/_/g, ' ')}</span>}
                      </div>
                      <ol className="preset-export-recs">
                        {(p.recommendations || []).map((rec, ri) => (
                          <li key={ri} className="preset-export-rec">
                            <span className="preset-name">{rec.preset?.name || rec.name}</span>
                            {rec.preset?.path && <span className="preset-path muted"> — {rec.preset.path}</span>}
                            {rec.preset?.also_apply && <div className="preset-also-apply muted">Also apply: {rec.preset.also_apply}</div>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Photos
