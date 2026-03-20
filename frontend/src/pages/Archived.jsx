import { useState, useEffect, useMemo } from 'react'
import { getArchivedIds, unarchivePhotos, archivePhotos, listPhotos, getRun, listRuns } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import PhotoDetail from '../components/PhotoDetail'

function Archived() {
  const [archivedIds, setArchivedIds] = useState(new Set())
  const [photos, setPhotos] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const [restoring, setRestoring] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const archData = await getArchivedIds()
        const ids = new Set(archData.photo_ids || [])
        setArchivedIds(ids)

        if (ids.size === 0) {
          setLoading(false)
          return
        }

        // Load all photos and filter to archived ones only
        const [photoData, runsData] = await Promise.all([
          listPhotos(),
          listRuns(),
        ])
        const allPhotos = photoData.photos || []
        setPhotos(allPhotos.filter(p => ids.has(p.id)))

        // Load results from the most recent run for metadata
        const runs = runsData.runs || []
        if (runs.length > 0) {
          try {
            const runData = await getRun(runs[0].run_id)
            setResults(runData.results || [])
          } catch { /* results are optional */ }
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

  async function handleRestore(ids) {
    const toRestore = Array.isArray(ids) ? ids : [...selectedIds]
    if (toRestore.length === 0) return
    setRestoring(true)
    setActionStatus(null)
    try {
      await unarchivePhotos(toRestore)
      setArchivedIds(prev => {
        const next = new Set(prev)
        toRestore.forEach(id => next.delete(id))
        return next
      })
      setPhotos(prev => prev.filter(p => !toRestore.includes(p.id)))
      setSelectedIds(new Set())
      if (selectedPhoto && toRestore.includes(selectedPhoto.id)) {
        setSelectedPhoto(null)
        setSelectedResult(null)
      }
      setActionStatus({ type: 'success', message: `${toRestore.length} photo${toRestore.length !== 1 ? 's' : ''} restored to Photos.` })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Restore failed: ${err.message}` })
    } finally {
      setRestoring(false)
    }
  }

  const currentIdx = selectedPhoto ? photos.findIndex(p => p.id === selectedPhoto.id) : -1

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        <p className="muted">Loading archived photos...</p>
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
        <div className="empty-page-icon">⊘</div>
        <h2>No archived photos</h2>
        <p className="muted">
          Go to <strong>Photos</strong> and click <strong>⊘</strong> on any photo to archive it.
        </p>
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
          Archived photos are hidden from the Photos tab but kept on disk. You can restore them here at any time.
        </p>
      </div>
    )
  }

  return (
    <div className="shortlist-page">
      <div className="photos-header">
        <div className="photos-header-left">
          <h1>Archived</h1>
          <span className="photos-count-badge">{photos.length} photos</span>
        </div>
        <div className="photos-header-right">
          <button
            className="btn btn-primary btn-small"
            onClick={() => handleRestore(selectedIds.size > 0 ? [...selectedIds] : photos.map(p => p.id))}
            disabled={restoring}
          >
            {restoring
              ? 'Restoring...'
              : selectedIds.size > 0
                ? `Restore (${selectedIds.size})`
                : 'Restore All'}
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
          Click ↩ on a photo to restore it to Photos
        </span>
      </div>

      <PhotoGrid
        photos={photos}
        results={results}
        onPhotoClick={handlePhotoClick}
        selectable
        selectedIds={selectedIds}
        onSelect={toggleSelection}
        archivedIds={archivedIds}
        onArchive={(id) => handleRestore([id])}
      />

      {selectedIds.size > 0 && (
        <div className="fab">
          <span className="fab-count">{selectedIds.size} selected</span>
          <div className="fab-divider" />
          <button
            className="btn btn-primary btn-small"
            onClick={() => handleRestore([...selectedIds])}
            disabled={restoring}
          >
            {restoring ? 'Restoring...' : `Restore (${selectedIds.size})`}
          </button>
        </div>
      )}

      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          result={selectedResult}
          runId={null}
          onClose={() => { setSelectedPhoto(null); setSelectedResult(null) }}
          onPrev={currentIdx > 0 ? () => handlePhotoNav(-1) : null}
          onNext={currentIdx < photos.length - 1 ? () => handlePhotoNav(1) : null}
          isArchived={archivedIds.has(selectedPhoto.id)}
          onArchive={(id) => handleRestore([id])}
        />
      )}
    </div>
  )
}

export default Archived
