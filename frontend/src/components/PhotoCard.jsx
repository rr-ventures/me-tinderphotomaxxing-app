function PhotoCard({ photo, result, onClick, selectable, selected, onSelect }) {
  const hasIssues = photo.needs_rotation || photo.needs_upscale
  const presetName = result?.preset_recommendation?.preset?.name

  function handleCheckboxClick(e) {
    e.stopPropagation()
    onSelect?.(photo.id)
  }

  return (
    <div
      className={`photo-card ${selected ? 'photo-card-selected' : ''}`}
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

        <div className="photo-card-overlay">
          {presetName && (
            <span className="card-preset-tag">{presetName}</span>
          )}
          {hasIssues && (
            <div className="photo-card-issues">
              {photo.needs_rotation && <span className="issue-badge rotation-badge" title={`Needs ${photo.rotation_degrees}° rotation`}>R</span>}
              {photo.needs_upscale && <span className="issue-badge upscale-badge" title="Low resolution — needs upscale">U</span>}
            </div>
          )}
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
