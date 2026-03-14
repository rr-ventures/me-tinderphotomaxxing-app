import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRun, listPhotos, batchEnhance, batchRename } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

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

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [runData, photoData] = await Promise.all([
          getRun(runId),
          listPhotos(),
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

  useEffect(() => {
    setSelectedIds(new Set())
    setBulkStatus(null)
  }, [activeTab])

  const results = run?.results || []
  const runErrors = run?.errors || []

  const analyzedPhotos = useMemo(() => {
    const ids = new Set(results.map(r => r.image_id))
    return photos.filter(p => ids.has(p.id))
  }, [photos, results])

  const shortlistPhotos = useMemo(
    () => analyzedPhotos.filter(p => shortlistIds.has(p.id)),
    [analyzedPhotos, shortlistIds]
  )

  const displayPhotos = activeTab === 'shortlist' ? shortlistPhotos : analyzedPhotos

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
    setSelectedResult(result)
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
          <h1>Preset Recommendations</h1>
          <p className="page-subtitle">
            Run: {run.run_id} &middot; Model: {run.model} &middot; {results.length} photos analyzed
          </p>
        </div>
        <Link to="/" className="btn btn-secondary">Back to Dashboard</Link>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{run.total_analyzed}</div>
          <div className="stat-label">Analyzed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Object.keys(presetCounts).length}</div>
          <div className="stat-label">Unique Presets</div>
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
        <details className="section">
          <summary><h2 style={{ display: 'inline' }}>Preset Distribution</h2></summary>
          <div className="preset-distribution" style={{ marginTop: 10 }}>
            {Object.entries(presetCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([preset, count]) => (
                <div key={preset} className="preset-dist-item">
                  <span className="preset-dist-name">{preset}</span>
                  <span className="preset-dist-count">{count}</span>
                </div>
              ))}
          </div>
        </details>
      )}

      {runErrors.length > 0 && (
        <details className="section">
          <summary><h2 className="text-error" style={{ display: 'inline' }}>Errors ({runErrors.length})</h2></summary>
          <div className="error-list" style={{ marginTop: 10 }}>
            {runErrors.map((err, i) => (
              <div key={i} className="error-item">
                <strong>{err.filename}</strong>: {err.error}
              </div>
            ))}
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

        <div className="selection-controls">
          <button className="btn btn-small" onClick={selectAll}>Select All</button>
          {selectedIds.size > 0 && (
            <button className="btn btn-small" onClick={selectNone}>Clear ({selectedIds.size})</button>
          )}
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : 'Click checkboxes to select photos'}
          </span>
        </div>

        {activeTab === 'shortlist' && shortlistPhotos.length === 0 && (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <p>No photos shortlisted yet.</p>
            <p className="muted">Switch to All Photos, select the ones you want, and click "Add to Shortlist".</p>
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
          onClose={() => {
            setSelectedPhoto(null)
            setSelectedResult(null)
          }}
        />
      )}
    </div>
  )
}

export default Analysis
