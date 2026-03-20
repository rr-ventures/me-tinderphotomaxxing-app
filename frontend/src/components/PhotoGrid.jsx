import { useState, useMemo, useCallback, useEffect } from 'react'
import PhotoCard from './PhotoCard'

const PHOTOS_PER_PAGE = 48

function PhotoGrid({ photos, results, onPhotoClick, selectable, selectedIds, onSelect, savedIds, shortlistIds, onShortlist, archivedIds, onArchive }) {
  const [page, setPage] = useState(0)

  // Reset to page 0 whenever the photos list changes (filter applied, archive, etc.)
  useEffect(() => {
    setPage(0)
  }, [photos])

  const resultMap = useMemo(() => {
    const map = {}
    if (results) results.forEach(r => { map[r.filename] = r })
    return map
  }, [results])

  const totalPages = Math.ceil((photos?.length ?? 0) / PHOTOS_PER_PAGE)
  const startIdx = page * PHOTOS_PER_PAGE
  const visiblePhotos = photos ? photos.slice(startIdx, startIdx + PHOTOS_PER_PAGE) : []

  // Stable click handler — avoids creating a new function per card per render
  const handleCardClick = useCallback((photo) => {
    if (onPhotoClick) onPhotoClick(photo, resultMap[photo.filename])
  }, [onPhotoClick, resultMap])

  if (!photos || photos.length === 0) {
    return <div className="empty-state">No photos found</div>
  }

  return (
    <div>
      <div className="grid-header">
        <span className="photo-count">{photos.length} photos</span>
        {totalPages > 1 && (
          <div className="pagination">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn btn-small"
            >
              Previous
            </button>
            <span className="page-info">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn btn-small"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <div className="photo-grid">
        {visiblePhotos.map(photo => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            result={resultMap[photo.filename]}
            onClick={() => handleCardClick(photo)}
            selectable={selectable}
            selected={selectedIds?.has(photo.id)}
            onSelect={onSelect}
            isSaved={savedIds?.has(photo.id)}
            isShortlisted={shortlistIds?.has(photo.id)}
            onShortlist={onShortlist}
            isArchived={archivedIds?.has(photo.id)}
            onArchive={onArchive}
          />
        ))}
      </div>
    </div>
  )
}

export default PhotoGrid
