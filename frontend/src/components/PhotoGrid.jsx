import { useState } from 'react'
import PhotoCard from './PhotoCard'

const PHOTOS_PER_PAGE = 48

function PhotoGrid({ photos, results, onPhotoClick, selectable, selectedIds, onSelect, savedIds, shortlistIds, onShortlist }) {
  const [page, setPage] = useState(0)

  if (!photos || photos.length === 0) {
    return <div className="empty-state">No photos found</div>
  }

  const totalPages = Math.ceil(photos.length / PHOTOS_PER_PAGE)
  const startIdx = page * PHOTOS_PER_PAGE
  const visiblePhotos = photos.slice(startIdx, startIdx + PHOTOS_PER_PAGE)

  // Key by filename so results match photos regardless of ID changes across environments/restarts
  const resultMap = {}
  if (results) {
    results.forEach(r => { resultMap[r.filename] = r })
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
            onClick={() => onPhotoClick && onPhotoClick(photo, resultMap[photo.filename])}
            selectable={selectable}
            selected={selectedIds?.has(photo.id)}
            onSelect={onSelect}
            isSaved={savedIds?.has(photo.id)}
            isShortlisted={shortlistIds?.has(photo.id)}
            onShortlist={onShortlist}
          />
        ))}
      </div>
    </div>
  )
}

export default PhotoGrid
