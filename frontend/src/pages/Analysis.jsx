import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRun, listPhotos, batchEnhance, batchRename, retryFailed, downloadRunPhotos, archivePhotos } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

const QUALITY_OPTIONS = [
  { value: '', label: 'All quality' },
  { value: '8', label: '8–10 (High)' },
  { value: '6', label: '6–7 (Medium)' },
  { value: '0', label: '1–5 (Low)' },
]

function Analysis() {
  const { runId } = useParams()
  const [run, setRun] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [shortlistIds, setShortlistIds] = useState(new Set())
  const [activeTab, setActiveTab] = useState('all')

  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [bulkStatus, setBulkStatus] = useState(null)

  const [retrying, setRetrying] = useState(false)
  const [retryStatus, setRetryStatus] = useState(null)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const [filterStyle, setFilterStyle] = useState('')
  const [filterQuality, setFilterQuality] = useState('')
  const [filterPreset, setFilterPreset] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [runData, photoData] = await Promise.all([
          getRun(runId),
          listPhotos(runId),
        ])
        setRun(runData)
        setPhotos(photoData.photos || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [runId])

  async function handleRetryFailed() {
    setRetrying(true)
    setRetryStatus(null)
    try {
      const updated = await retryFailed(runId)
      setRun(updated)
      const photoData = await listPhotos(runId)
      setPhotos(photoData.photos || [])
      const stillFailed = updated.errors?.length || 0
      const newlyFixed = (run?.errors?.length || 0) - stillFailed
      setRetryStatus({
        type: stillFailed > 0 ? 'warning' : 'success',
        message: `Retry complete. ${newlyFixed} fixed${stillFailed > 0 ? `, ${stillFailed} still failed` : ''}.`,
      })
    } catch (err) {
      setRetryStatus({ type: 'error', message: `Retry failed: ${err.message}` })
    } finally {
      setRetrying(false)
    }
  }

  useEffect(() => {
    setSelectedIds(new Set())
    setBulkStatus(null)
  }, [activeTab])

  const results = run?.results || []
  const runErrors = run?.errors || []

  // Match run results to on-disk photos by FILENAME — include analyzed + archived
  const analyzedPhotos = useMemo(() => {
    const filenames = new Set(results.map(r => r.filename))
    return photos.filter(p => filenames.has(p.filename))
  }, [photos, results])

  // Build a filename→result lookup for passing to PhotoDetail
  const resultByFilename = useMemo(() => {
    const map = {}
    results.forEach(r => { map[r.filename] = r })
    return map
  }, [results])

  // Unique styles and presets for filter dropdowns
  const uniqueStyles = useMemo(() => {
    const s = new Set(results.map(r => r.primary_style).filter(Boolean))
    return [...s].sort()
  }, [results])

  const uniquePresets = useMemo(() => {
    const s = new Set(results.map(r => r.preset_recommendation?.preset?.name).filter(Boolean))
    return [...s].sort()
  }, [results])

  // Apply filters
  const filteredPhotos = useMemo(() => {
    let base = analyzedPhotos
    if (filterStyle) {
      const styleFilenames = new Set(results.filter(r => r.primary_style === filterStyle).map(r => r.filename))
      base = base.filter(p => styleFilenames.has(p.filename))
    }
    if (filterPreset) {
      const presetFilenames = new Set(results.filter(r => r.preset_recommendation?.preset?.name === filterPreset).map(r => r.filename))
      base = base.filter(p => presetFilenames.has(p.filename))
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
  }, [analyzedPhotos, filterStyle, filterPreset, filterQuality, results, resultByFilename])

  const shortlistPhotos = useMemo(
    () => filteredPhotos.filter(p => shortlistIds.has(p.id)),
    [filteredPhotos, shortlistIds]
  )

  const displayPhotos = activeTab === 'shortlist' ? shortlistPhotos : filteredPhotos

  const hasActiveFilters = !!(filterStyle || filterPreset || filterQuality)

  const presetCounts = useMemo(() => {
    const counts = {}
    results.forEach(r => {
      const preset = r.preset_recommendation?.preset?.name || 'No recommendation'
      counts[preset] = (counts[preset] || 0) + 1
    })
    return counts
  }, [results])

  function handlePhotoClick(photo, result) {
    setSelectedPhoto(photo)
    setSelectedResult(result || resultByFilename[photo.filename] || null)
  }

  function handlePhotoNav(direction) {
    if (!selectedPhoto) return
    const idx = displayPhotos.findIndex(p => p.id === selectedPhoto.id)
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= displayPhotos.length) return
    const next = displayPhotos[nextIdx]
    setSelectedPhoto(next)
    setSelectedResult(resultByFilename[next.filename] || null)
  }

  function toggleSelection(photoId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(displayPhotos.map(p => p.id)))
  }

  function selectNone() {
    setSelectedIds(new Set())
  }

  function addToShortlist() {
    setShortlistIds(prev => {
      const next = new Set(prev)
      selectedIds.forEach(id => next.add(id))
      return next
    })
    setSelectedIds(new Set())
    setActiveTab('shortlist')
  }

  function removeFromShortlist() {
    setShortlistIds(prev => {
      const next = new Set(prev)
      selectedIds.forEach(id => next.delete(id))
      return next
    })
    setSelectedIds(new Set())
  }

  async function handleArchive(ids) {
    if (!ids || ids.length === 0) return
    setBulkRunning(true)
    setBulkStatus(null)
    try {
      const res = await archivePhotos(ids)
      setBulkStatus({
        type: 'success',
        message: `${res.archived} photo${res.archived !== 1 ? 's' : ''} archived.${res.errors > 0 ? ` ${res.errors} failed.` : ''}`,
      })
      setSelectedIds(new Set())
      // Reload photos so archived ones disappear from the grid
      const photoData = await listPhotos()
      setPhotos(photoData.photos || [])
    } catch (err) {
      setBulkStatus({ type: 'error', message: `Archive failed: ${err.message}` })
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleDownload(ids = null) {
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadRunPhotos(runId, ids, 'analyzed')
    } catch (err) {
      setDownloadError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  async function handleBulkAction(action) {
    const ids = [...selectedIds]
    if (ids.length === 0) return

    setBulkRunning(true)
    setBulkStatus(null)
    setBulkProgress(`Starting ${action} on ${ids.length} photos...`)

    try {
      if (action === 'rename') {
        const res = await batchRename(ids, runId)
        const ok = res.total_renamed || 0
        const errs = res.total_errors || 0
        setBulkStatus({
          type: errs > 0 ? 'warning' : 'success',
          message: `${ok} photo${ok !== 1 ? 's' : ''} renamed to preset${errs > 0 ? `, ${errs} error${errs !== 1 ? 's' : ''}` : ''}.`,
        })
      } else {
        const res = await batchEnhance(ids, {
          runId,
          crop: action === 'crop' || action === 'all',
          upscale: action === 'enhance' || action === 'all',
          upscaleMode: 'enhance',
          save: action === 'save' || action === 'all',
          renameToPreset: action === 'all',
        })

        const ok = res.total_processed || 0
        const errs = res.total_errors || 0
        setBulkStatus({
          type: errs > 0 ? 'warning' : 'success',
          message: `${ok} photo${ok !== 1 ? 's' : ''} processed${errs > 0 ? `, ${errs} error${errs !== 1 ? 's' : ''}` : ''}.`,
        })
      }
    } catch (err) {
      setBulkStatus({ type: 'error', message: `Bulk ${action} failed: ${err.message}` })
    } finally {
      setBulkRunning(false)
      setBulkProgress(null)
    }
  }

  if (loading) {
    return (
      <div className="loading-page">
        <h1>Loading results...</h1>
        <p className="muted">Fetching run {runId}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-page">
        <h1>Error</h1>
        <p className="text-error">{error}</p>
        <Link to="/" className="btn btn-secondary">Back to Dashboard</Link>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="error-page">
        <h1>Run not found</h1>
        <Link to="/" className="btn btn-secondary">Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="analysis-page">
      <div className="page-header">
        <div>
          <h1>Analysis Results</h1>
          <p className="page-subtitle">
            {run.run_id} &middot; {results.length} photos &middot; {run.model}
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-primary"
            onClick={() => handleDownload(null)}
            disabled={downloading || results.length === 0}
            title={`Download all ${results.length} analyzed photos as ZIP`}
          >
            {downloading ? 'Preparing ZIP...' : `Download All (${results.length})`}
          </button>
          <Link to="/" className="btn btn-secondary">← Dashboard</Link>
        </div>
      </div>
      {downloadError && (
        <div className="alert alert-error">
          <strong>Download failed:</strong> {downloadError}
          <button onClick={() => setDownloadError(null)} className="alert-dismiss">Dismiss</button>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{run.total_analyzed}</div>
          <div className="stat-label">Photos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Object.keys(presetCounts).length}</div>
          <div className="stat-label">Presets Used</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${run.estimated_cost_usd?.toFixed(4)}</div>
          <div className="stat-label">Cost</div>
        </div>
        <div className={`stat-card ${shortlistIds.size > 0 ? 'stat-accent' : ''}`}>
          <div className="stat-value">{shortlistIds.size}</div>
          <div className="stat-label">Shortlisted</div>
        </div>
      </div>

      {Object.keys(presetCounts).length > 0 && (
        <details className="section" open>
          <summary><h2 style={{ display: 'inline' }}>Preset Breakdown</h2></summary>
          <div className="preset-distribution" style={{ marginTop: 10 }}>
            {Object.entries(presetCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([preset, count]) => (
                <div
                  key={preset}
                  className={`preset-dist-item ${filterPreset === preset ? 'preset-dist-item-active' : ''}`}
                  onClick={() => setFilterPreset(filterPreset === preset ? '' : preset)}
                  title="Click to filter by this preset"
                  style={{ cursor: 'pointer' }}
                >
                  <span className="preset-dist-name">{preset}</span>
                  <span className="preset-dist-count">{count}</span>
                </div>
              ))}
          </div>
        </details>
      )}

      {runErrors.length > 0 && (
        <details className="section" open>
          <summary>
            <h2 className="text-error" style={{ display: 'inline' }}>
              Errors ({runErrors.length})
            </h2>
          </summary>
          <div style={{ marginTop: 10 }}>
            <div className="error-list">
              {runErrors.map((err, i) => (
                <div key={i} className="error-item">
                  <strong>{err.filename}</strong>: {err.error}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                className="btn btn-primary"
                onClick={handleRetryFailed}
                disabled={retrying}
              >
                {retrying ? 'Retrying...' : `Retry Failed (${runErrors.length})`}
              </button>
              {retryStatus && (
                <span className={`action-status ${
                  retryStatus.type === 'success' ? 'action-success'
                    : retryStatus.type === 'warning' ? 'action-warning'
                      : 'action-error'
                }`} style={{ display: 'inline' }}>
                  {retryStatus.message}
                </span>
              )}
            </div>
          </div>
        </details>
      )}

      <div className="section">
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'all' ? 'tab-btn-active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Photos ({analyzedPhotos.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'shortlist' ? 'tab-btn-active' : ''}`}
            onClick={() => setActiveTab('shortlist')}
          >
            Shortlist ({shortlistIds.size})
          </button>
        </div>

        {/* Filter bar */}
        {activeTab === 'all' && (
          <div className="filter-bar">
            <select
              className="filter-select"
              value={filterStyle}
              onChange={e => setFilterStyle(e.target.value)}
            >
              <option value="">All styles</option>
              {uniqueStyles.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              className="filter-select"
              value={filterPreset}
              onChange={e => setFilterPreset(e.target.value)}
            >
              <option value="">All presets</option>
              {uniquePresets.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              className="filter-select"
              value={filterQuality}
              onChange={e => setFilterQuality(e.target.value)}
            >
              {QUALITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {hasActiveFilters && (
              <button
                className="btn btn-small"
                onClick={() => { setFilterStyle(''); setFilterPreset(''); setFilterQuality('') }}
              >
                Clear filters ({filteredPhotos.length} shown)
              </button>
            )}
            {!hasActiveFilters && (
              <span className="muted" style={{ fontSize: '0.8rem' }}>{filteredPhotos.length} photos</span>
            )}
          </div>
        )}

        <div className="selection-controls">
          <button className="btn btn-small" onClick={selectAll}>Select All</button>
          {selectedIds.size > 0 && (
            <button className="btn btn-small" onClick={selectNone}>Clear ({selectedIds.size})</button>
          )}
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : 'Click a photo to open it · use checkboxes to select multiple'}
          </span>
        </div>

        {activeTab === 'shortlist' && shortlistPhotos.length === 0 && (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <p>No photos shortlisted yet.</p>
            <p className="muted">Switch to All Photos, select photos using the checkboxes, then click "Shortlist".</p>
          </div>
        )}

        {displayPhotos.length > 0 && (
          <PhotoGrid
            photos={displayPhotos}
            results={results}
            onPhotoClick={handlePhotoClick}
            selectable={true}
            selectedIds={selectedIds}
            onSelect={toggleSelection}
          />
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="floating-action-bar">
          <div className="fab-left">
            <span className="fab-count">{selectedIds.size} selected</span>
          </div>
          <div className="fab-actions">
            <button
              className="btn btn-secondary"
              onClick={() => handleBulkAction('crop')}
              disabled={bulkRunning}
            >
              Bulk Crop
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handleBulkAction('enhance')}
              disabled={bulkRunning}
            >
              Bulk Enhance
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleBulkAction('save')}
              disabled={bulkRunning}
            >
              Bulk Save
            </button>
            <button
              className="btn btn-accent"
              onClick={() => handleBulkAction('rename')}
              disabled={bulkRunning}
              title="Save photos to processed/ renamed to their recommended Lightroom preset"
            >
              Rename to Preset
            </button>
            <div className="fab-divider" />
            <button
              className="btn btn-primary btn-small"
              onClick={() => handleDownload([...selectedIds])}
              disabled={bulkRunning || downloading}
              title="Download selected photos as ZIP"
            >
              {downloading ? 'Zipping...' : `Download (${selectedIds.size})`}
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={() => handleArchive([...selectedIds])}
              disabled={bulkRunning}
              title="Move selected photos to archived/ — out of the pipeline but not deleted"
            >
              Archive ({selectedIds.size})
            </button>
            {activeTab === 'all' && (
              <>
                <div className="fab-divider" />
                <button className="btn btn-small" onClick={addToShortlist} disabled={bulkRunning}>
                  Shortlist
                </button>
              </>
            )}
            {activeTab === 'shortlist' && (
              <>
                <div className="fab-divider" />
                <button
                  className="btn btn-danger btn-small"
                  onClick={removeFromShortlist}
                  disabled={bulkRunning}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(bulkRunning || bulkStatus) && (
        <div className="bulk-status-bar">
          {bulkRunning && (
            <div className="bulk-progress">
              <div className="upscale-spinner" />
              <span>{bulkProgress}</span>
            </div>
          )}
          {bulkStatus && (
            <div className={`action-status ${
              bulkStatus.type === 'success' ? 'action-success'
                : bulkStatus.type === 'warning' ? 'action-warning'
                  : 'action-error'
            }`}>
              {bulkStatus.message}
              <button className="alert-dismiss" onClick={() => setBulkStatus(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          result={selectedResult}
          runId={runId}
          onClose={() => { setSelectedPhoto(null); setSelectedResult(null) }}
          onPrev={displayPhotos.findIndex(p => p.id === selectedPhoto.id) > 0
            ? () => handlePhotoNav(-1) : null}
          onNext={displayPhotos.findIndex(p => p.id === selectedPhoto.id) < displayPhotos.length - 1
            ? () => handlePhotoNav(1) : null}
        />
      )}
    </div>
  )
}

export default Analysis
