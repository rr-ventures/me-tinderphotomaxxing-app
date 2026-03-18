import { useState, useEffect, useMemo } from 'react'
import { getSaved, removeFromSaved, listPhotos, getRun, downloadRunPhotos, archivePhotos } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

function Saved() {
  const [savedIds, setSavedIds] = useState(new Set())
  const [runId, setRunId] = useState(null)
  const [photos, setPhotos] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const [removing, setRemoving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const savedData = await getSaved()
        const ids = new Set(savedData.photo_ids || [])
        setSavedIds(ids)
        setRunId(savedData.run_id || null)

        if (savedData.run_id && ids.size > 0) {
          const [runData, photoData] = await Promise.all([
            getRun(savedData.run_id),
            listPhotos(savedData.run_id),
          ])
          setResults(runData.results || [])
          // Only show photos that are in the saved list
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

  async function handleRemove() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setRemoving(true)
    setActionStatus(null)
    try {
      await removeFromSaved(ids)
      setSavedIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      setPhotos(prev => prev.filter(p => !ids.includes(p.id)))
      setSelectedIds(new Set())
      setActionStatus({ type: 'success', message: `${ids.length} photo${ids.length !== 1 ? 's' : ''} removed from Saved.` })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Failed: ${err.message}` })
    } finally {
      setRemoving(false)
    }
  }

  async function handleDownload() {
    if (!runId) return
    setDownloading(true)
    setActionStatus(null)
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : [...savedIds]
      await downloadRunPhotos(runId, ids, 'analyzed')
    } catch (err) {
      setActionStatus({ type: 'error', message: `Download failed: ${err.message}` })
    } finally {
      setDownloading(false)
    }
  }

  async function handleArchive() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : [...savedIds]
    if (ids.length === 0) return
    setArchiving(true)
    setActionStatus(null)
    try {
      const res = await archivePhotos(ids)
      // Remove archived photos from saved list too
      await removeFromSaved(ids)
      setSavedIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      setPhotos(prev => prev.filter(p => !ids.includes(p.id)))
      setSelectedIds(new Set())
      setActionStatus({ type: 'success', message: `${res.archived} photo${res.archived !== 1 ? 's' : ''} archived.` })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Archive failed: ${err.message}` })
    } finally {
      setArchiving(false)
    }
  }

  const currentIdx = selectedPhoto ? photos.findIndex(p => p.id === selectedPhoto.id) : -1

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <p className="muted">Loading saved photos...</p>
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
        <div className="empty-page-icon">★</div>
        <h2>No saved photos yet</h2>
        <p className="muted">Go to Photos, select the ones you like, and click <strong>★ Save</strong>.</p>
      </div>
    )
  }

  return (
    <div className="saved-page">
      <div className="photos-header">
        <div className="photos-header-left">
          <h1>Saved</h1>
          <span className="photos-count-badge">{photos.length} photos</span>
        </div>
        <div className="photos-header-right">
          <button
            className="btn btn-primary btn-small"
            onClick={handleDownload}
            disabled={downloading || !runId}
          >
            {downloading ? 'Zipping...' : selectedIds.size > 0 ? `Download (${selectedIds.size})` : `Download All (${photos.length})`}
          </button>
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
          Click a photo to open it · select to bulk action
        </span>
      </div>

      <PhotoGrid
        photos={photos}
        results={results}
        onPhotoClick={handlePhotoClick}
        selectable
        selectedIds={selectedIds}
        onSelect={toggleSelection}
        savedIds={savedIds}
      />

      {selectedIds.size > 0 && (
        <div className="fab">
          <span className="fab-count">{selectedIds.size} selected</span>
          <div className="fab-divider" />
          <button className="btn btn-small" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Zipping...' : `Download (${selectedIds.size})`}
          </button>
          <button className="btn btn-danger btn-small" onClick={handleArchive} disabled={archiving}>
            {archiving ? 'Archiving...' : `Archive (${selectedIds.size})`}
          </button>
          <button className="btn btn-small" onClick={handleRemove} disabled={removing}>
            {removing ? 'Removing...' : `Remove from Saved (${selectedIds.size})`}
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

export default Saved
