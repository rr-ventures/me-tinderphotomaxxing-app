function PhotoCard({ photo, result, onClick, selectable, selected, onSelect, isSaved, isShortlisted, onShortlist }) {
  const presetName = result?.preset_recommendation?.preset?.name
  const quality = result?.metadata?.photo_quality
  const qualityColor = quality >= 8 ? '#22c55e' : quality >= 6 ? '#f59e0b' : quality ? '#ef4444' : null

  function handleCheckboxClick(e) {
    e.stopPropagation()
    onSelect?.(photo.id)
  }

  function handleShortlistClick(e) {
    e.stopPropagation()
    onShortlist?.(photo.id)
  }

  return (
    <div
      className={`photo-card ${selected ? 'photo-card-selected' : ''} ${isShortlisted ? 'photo-card-shortlisted' : ''}`}
      onClick={onClick}
    >
      <div className="photo-card-image">
        {photo.thumbnail_url ? (
          <img
            src={photo.thumbnail_url}
            alt={photo.filename}
            loading="lazy"
          />
        ) : (
          <div className="photo-placeholder">No preview</div>
        )}

        {selectable && (
          <div className="photo-card-checkbox" onClick={handleCheckboxClick}>
            <input
              type="checkbox"
              checked={!!selected}
              readOnly
            />
          </div>
        )}

        {/* Shortlist star — always visible, top-left */}
        {onShortlist && (
          <button
            className={`photo-card-star ${isShortlisted ? 'photo-card-star-active' : ''}`}
            onClick={handleShortlistClick}
            title={isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
          >
            ★
          </button>
        )}

        <div className="photo-card-overlay">
          {presetName && (
            <span className="card-preset-tag">{presetName}</span>
          )}
          <div className="photo-card-badges">
            {isSaved && (
              <span className="issue-badge saved-badge" title="Saved">✓</span>
            )}
            {quality != null && (
              <span
                className="issue-badge quality-badge"
                style={{ background: qualityColor }}
                title={`AI quality score: ${quality}/10`}
              >
                {quality}/10
              </span>
            )}
            {photo.needs_rotation && <span className="issue-badge rotation-badge" title={`Needs ${photo.rotation_degrees}° rotation`}>↻</span>}
            {photo.needs_upscale && <span className="issue-badge upscale-badge" title="Low resolution — needs upscale">↑</span>}
          </div>
        </div>
      </div>

      <div className="photo-card-info">
        <span className="photo-card-name" title={photo.filename}>
          {photo.filename.length > 20
            ? photo.filename.slice(0, 17) + '...'
            : photo.filename}
        </span>
        {result?.preset_recommendation?.name && (
          <span className="photo-card-scenario">{result.preset_recommendation.name}</span>
        )}
      </div>
    </div>
  )
}

export default PhotoCard
