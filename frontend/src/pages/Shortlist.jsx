import { useState, useEffect, useMemo } from 'react'
import { getShortlist, removeFromShortlist, addToSaved, listPhotos, getRun, downloadRunPhotos } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

function Shortlist() {
  const [shortlistIds, setShortlistIds] = useState(new Set())
  const [runId, setRunId] = useState(null)
  const [photos, setPhotos] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const [movingToSaved, setMovingToSaved] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const slData = await getShortlist()
        const ids = new Set(slData.photo_ids || [])
        setShortlistIds(ids)
        setRunId(slData.run_id || null)

        if (ids.size > 0 && slData.run_id) {
          const [runData, photoData] = await Promise.all([
            getRun(slData.run_id),
            listPhotos(slData.run_id),
          ])
          setResults(runData.results || [])
          setPhotos((photoData.photos || []).filter(p => ids.has(p.id)))
        } else if (ids.size > 0) {
          // run_id might be 'all' or missing — load all photos and filter
          const photoData = await listPhotos()
          setPhotos((photoData.photos || []).filter(p => ids.has(p.id)))
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const resultByFilename = useMemo(() => {
    const map = {}
    results.forEach(r => { map[r.filename] = r })
    return map
  }, [results])

  function handlePhotoClick(photo, result) {
    setSelectedPhoto(photo)
    setSelectedResult(result || resultByFilename[photo.filename] || null)
  }

  function handlePhotoNav(direction) {
    if (!selectedPhoto) return
    const idx = photos.findIndex(p => p.id === selectedPhoto.id)
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= photos.length) return
    const next = photos[nextIdx]
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

  async function handleRemoveFromShortlist(ids) {
    const toRemove = ids || [...selectedIds]
    if (toRemove.length === 0) return
    setRemoving(true)
    setActionStatus(null)
    try {
      await removeFromShortlist(toRemove)
      setShortlistIds(prev => {
        const next = new Set(prev)
        toRemove.forEach(id => next.delete(id))
        return next
      })
      setPhotos(prev => prev.filter(p => !toRemove.includes(p.id)))
      setSelectedIds(new Set())
      setActionStatus({ type: 'success', message: `${toRemove.length} photo${toRemove.length !== 1 ? 's' : ''} removed from shortlist.` })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Failed: ${err.message}` })
    } finally {
      setRemoving(false)
    }
  }

  async function handleMoveToSaved() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : [...shortlistIds]
    if (ids.length === 0) return
    setMovingToSaved(true)
    setActionStatus(null)
    try {
      await addToSaved(ids, runId)
      setActionStatus({ type: 'success', message: `${ids.length} photo${ids.length !== 1 ? 's' : ''} moved to Saved.` })
      setSelectedIds(new Set())
    } catch (err) {
      setActionStatus({ type: 'error', message: `Failed: ${err.message}` })
    } finally {
      setMovingToSaved(false)
    }
  }

  async function handleDownload() {
    if (!runId || runId === 'all') return
    setDownloading(true)
    setActionStatus(null)
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : [...shortlistIds]
      await downloadRunPhotos(runId, ids, 'analyzed')
    } catch (err) {
      setActionStatus({ type: 'error', message: `Download failed: ${err.message}` })
    } finally {
      setDownloading(false)
    }
  }

  const currentIdx = selectedPhoto ? photos.findIndex(p => p.id === selectedPhoto.id) : -1

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <p className="muted">Loading shortlist...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-page">
        <h2>Error</h2>
        <p className="text-error">{error}</p>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className="empty-page">
        <div className="empty-page-icon">☆</div>
        <h2>No shortlisted photos yet</h2>
        <p className="muted">
          Go to <strong>Photos</strong> and click the <strong>★</strong> on any photo to shortlist it.
        </p>
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
          Use shortlist to quickly mark photos worth processing further — without losing your place in the 250-photo grid.
        </p>
      </div>
    )
  }

  return (
    <div className="shortlist-page">
      <div className="photos-header">
        <div className="photos-header-left">
          <h1>Shortlist</h1>
          <span className="photos-count-badge">{photos.length} photos</span>
        </div>
        <div className="photos-header-right">
          <button
            className="btn btn-primary btn-small"
            onClick={handleMoveToSaved}
            disabled={movingToSaved}
          >
            {movingToSaved ? 'Moving...' : selectedIds.size > 0 ? `Move to Saved (${selectedIds.size})` : `Move All to Saved`}
          </button>
          {runId && runId !== 'all' && (
            <button
              className="btn btn-small"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? 'Zipping...' : `Download`}
            </button>
          )}
        </div>
      </div>

      {actionStatus && (
        <div className={`alert ${actionStatus.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {actionStatus.message}
          <button onClick={() => setActionStatus(null)} className="alert-dismiss">✕</button>
        </div>
      )}

      <div className="filter-bar">
        <button className="btn btn-small" onClick={() => setSelectedIds(new Set(photos.map(p => p.id)))}>
          Select All
        </button>
        {selectedIds.size > 0 && (
          <button className="btn btn-small" onClick={() => setSelectedIds(new Set())}>
            Clear ({selectedIds.size})
          </button>
        )}
        <span className="filter-bar-spacer" />
        <span className="muted" style={{ fontSize: '0.82rem' }}>
          Click ★ on a photo to remove it from shortlist
        </span>
      </div>

      <PhotoGrid
        photos={photos}
        results={results}
        onPhotoClick={handlePhotoClick}
        selectable
        selectedIds={selectedIds}
        onSelect={toggleSelection}
        shortlistIds={shortlistIds}
        onShortlist={(id) => handleRemoveFromShortlist([id])}
      />

      {selectedIds.size > 0 && (
        <div className="fab">
          <span className="fab-count">{selectedIds.size} selected</span>
          <div className="fab-divider" />
          <button className="btn btn-primary btn-small" onClick={handleMoveToSaved} disabled={movingToSaved}>
            {movingToSaved ? 'Moving...' : `Move to Saved (${selectedIds.size})`}
          </button>
          <button className="btn btn-small" onClick={() => handleRemoveFromShortlist([...selectedIds])} disabled={removing}>
            {removing ? 'Removing...' : `Remove (${selectedIds.size})`}
          </button>
        </div>
      )}

      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          result={selectedResult}
          runId={runId}
          onClose={() => { setSelectedPhoto(null); setSelectedResult(null) }}
          onPrev={currentIdx > 0 ? () => handlePhotoNav(-1) : null}
          onNext={currentIdx < photos.length - 1 ? () => handlePhotoNav(1) : null}
        />
      )}
    </div>
  )
}

export default Shortlist
