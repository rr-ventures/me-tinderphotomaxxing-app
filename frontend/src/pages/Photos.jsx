import { useState, useEffect, useMemo, useCallback } from 'react'
import { listRuns, getRun, listPhotos, addToSaved, getSaved, getShortlist, addToShortlist, removeFromShortlist, downloadRunPhotos, archivePhotos, unarchivePhotos, getArchivedIds, getMergedRun } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

const QUALITY_OPTIONS = [
  { value: '', label: 'All quality' },
  { value: '8', label: '8–10 High' },
  { value: '6', label: '6–7 Medium' },
  { value: '0', label: '1–5 Low' },
]

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
  const [archiving, setArchiving] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

  // Load runs list + saved IDs on mount
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

  // Load run + photos whenever selectedRunId changes
  useEffect(() => {
    if (!selectedRunId) return
    async function loadRun() {
      setLoading(true)
      setError(null)
      setSelectedIds(new Set())
      try {
        if (selectedRunId === 'all') {
          // Merged view: load all run results + photos from all analyzed folders
          const [runData, photoData] = await Promise.all([
            getMergedRun(),
            listPhotos(),  // no run_id = scan all analyzed photos
          ])
          setRun(runData)
          setPhotos(photoData.photos || [])
        } else {
          const [runData, photoData] = await Promise.all([
            getRun(selectedRunId),
            listPhotos(selectedRunId),
          ])
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

  const results = run?.results || []

  const resultByFilename = useMemo(() => {
    const map = {}
    results.forEach(r => { map[r.filename] = r })
    return map
  }, [results])

  const uniqueStyles = useMemo(() => {
    const s = new Set(results.map(r => r.primary_style).filter(Boolean))
    return [...s].sort()
  }, [results])

  const uniquePresets = useMemo(() => {
    const s = new Set(results.map(r => r.preset_recommendation?.preset?.name).filter(Boolean))
    return [...s].sort()
  }, [results])

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
      const nextIdx = idx + direction
      if (nextIdx < 0 || nextIdx >= filteredPhotos.length) return prev
      const next = filteredPhotos[nextIdx]
      setSelectedResult(resultByFilename[next.filename] || null)
      return next
    })
  }, [filteredPhotos, resultByFilename])

  const toggleSelection = useCallback((photoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }, [])

  const handleToggleShortlist = useCallback(async (photoId) => {
    const isShortlisted = shortlistIds.has(photoId)
    try {
      if (isShortlisted) {
        await removeFromShortlist([photoId])
        setShortlistIds(prev => { const n = new Set(prev); n.delete(photoId); return n })
      } else {
        await addToShortlist([photoId], selectedRunId)
        setShortlistIds(prev => new Set([...prev, photoId]))
      }
    } catch { /* silent */ }
  }, [shortlistIds, selectedRunId])

  const handleToggleArchive = useCallback(async (photoId) => {
    const isArchived = archivedIds.has(photoId)
    try {
      if (isArchived) {
        await unarchivePhotos([photoId])
        setArchivedIds(prev => { const n = new Set(prev); n.delete(photoId); return n })
      } else {
        await archivePhotos([photoId])
        setArchivedIds(prev => new Set([...prev, photoId]))
        // Close modal if this photo was being viewed
        if (selectedPhoto?.id === photoId) {
          setSelectedPhoto(null)
          setSelectedResult(null)
        }
        // Remove from grid immediately
        setPhotos(prev => prev.filter(p => p.id !== photoId))
      }
    } catch { /* silent */ }
  }, [archivedIds, selectedPhoto])

  async function handleAddToSaved() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setSaving(true)
    setSaveStatus(null)
    try {
      await addToSaved(ids, selectedRunId)
      setSavedIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.add(id))
        return next
      })
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

  async function handleArchive() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setArchiving(true)
    setActionStatus(null)
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

  const currentIdx = useMemo(
    () => selectedPhoto ? filteredPhotos.findIndex(p => p.id === selectedPhoto.id) : -1,
    [selectedPhoto, filteredPhotos]
  )

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <p className="muted">Loading photos...</p>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="empty-page">
        <div className="empty-page-icon">📷</div>
        <h2>No analyzed photos yet</h2>
        <p className="muted">Go to Analyze to run your first analysis.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-page">
        <h2>Error loading photos</h2>
        <p className="text-error">{error}</p>
        <button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  return (
    <div className="photos-page">
      {/* Header row */}
      <div className="photos-header">
        <div className="photos-header-left">
          <h1>Photos</h1>
          {run && (
            <span className="photos-count-badge">{filteredPhotos.length} photos</span>
          )}
        </div>
        <div className="photos-header-right">
          {/* Run selector */}
          {runs.length > 0 && (
            <select
              className="run-selector"
              value={selectedRunId || ''}
              onChange={e => setSelectedRunId(e.target.value)}
            >
              <option value="all">All runs combined</option>
              {runs.map((r, i) => (
                <option key={r.run_id} value={r.run_id}>
                  {i === 0 ? '★ ' : ''}{r.run_id} ({r.total_analyzed} photos)
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn-primary btn-small"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Zipping...' : selectedIds.size > 0 ? `Download (${selectedIds.size})` : `Download All`}
          </button>
        </div>
      </div>

      {/* Status messages */}
      {saveStatus && (
        <div className={`alert ${saveStatus.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {saveStatus.message}
          <button onClick={() => setSaveStatus(null)} className="alert-dismiss">✕</button>
        </div>
      )}
      {actionStatus && (
        <div className={`alert ${actionStatus.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {actionStatus.message}
          <button onClick={() => setActionStatus(null)} className="alert-dismiss">✕</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <select className="filter-select" value={filterStyle} onChange={e => setFilterStyle(e.target.value)}>
          <option value="">All styles</option>
          {uniqueStyles.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select className="filter-select" value={filterPreset} onChange={e => setFilterPreset(e.target.value)}>
          <option value="">All presets</option>
          {uniquePresets.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select className="filter-select" value={filterQuality} onChange={e => setFilterQuality(e.target.value)}>
          {QUALITY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button className="btn btn-small" onClick={() => { setFilterStyle(''); setFilterPreset(''); setFilterQuality('') }}>
            Clear filters
          </button>
        )}
        <span className="filter-bar-spacer" />
        <button className="btn btn-small" onClick={() => setSelectedIds(new Set(filteredPhotos.map(p => p.id)))}>
          Select All
        </button>
        {selectedIds.size > 0 && (
          <button className="btn btn-small" onClick={() => setSelectedIds(new Set())}>
            Clear ({selectedIds.size})
          </button>
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

      {/* Floating action bar when photos are selected */}
      {selectedIds.size > 0 && (
        <div className="fab">
          <span className="fab-count">{selectedIds.size} selected</span>
          <div className="fab-divider" />
          <button
            className="btn btn-primary btn-small"
            onClick={handleAddToSaved}
            disabled={saving}
          >
            {saving ? 'Saving...' : `★ Save (${selectedIds.size})`}
          </button>
          <button
            className="btn btn-small"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Zipping...' : `Download (${selectedIds.size})`}
          </button>
          <button
            className="btn btn-danger btn-small"
            onClick={handleArchive}
            disabled={archiving}
          >
            {archiving ? 'Archiving...' : `Archive (${selectedIds.size})`}
          </button>
        </div>
      )}

      {/* Photo detail modal */}
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
        />
      )}
    </div>
  )
}

export default Photos
