/*
 * LEARNING NOTE: Settings page — model info and app configuration.
 *
 * This is a simple page that displays available models and their pricing.
 * In a full app, this would also have user preferences, API key management, etc.
 *
 * COMPONENT LIFECYCLE:
 *   1. React renders the component → you see "Loading..."
 *   2. useEffect fires → fetches models from API
 *   3. State updates → React re-renders with the model data
 *   4. You see the model cards
 *
 *   This render → fetch → update → re-render cycle is the core
 *   pattern of every React app.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listModels, resetApp, getFolderCounts, getShortlist, getSaved, getArchivedIds } from '../api/client'

function Settings() {
  const navigate = useNavigate()
  const [models, setModels] = useState([])
  const [defaultModel, setDefaultModel] = useState('')
  const [loading, setLoading] = useState(true)

  // Counts for the reset summary
  const [counts, setCounts] = useState(null)
  const [countsLoading, setCountsLoading] = useState(true)

  // Reset state
  const [confirmMode, setConfirmMode] = useState(null) // null | 'new_batch' | 'full_wipe'
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState(null)
  const [resetError, setResetError] = useState(null)

  useEffect(() => {
    listModels()
      .then(data => {
        setModels(data.models || [])
        setDefaultModel(data.default || '')
      })
      .catch(err => console.error('Failed to load models:', err))
      .finally(() => setLoading(false))

    Promise.all([getFolderCounts(), getShortlist(), getSaved(), getArchivedIds()])
      .then(([folderCounts, sl, saved, arch]) => {
        setCounts({
          analyzed: folderCounts.analyzed ?? 0,
          archived: arch.photo_ids?.length ?? 0,
          shortlisted: sl.photo_ids?.length ?? 0,
          saved: saved.photo_ids?.length ?? 0,
          toProcess: folderCounts.to_process ?? 0,
        })
      })
      .catch(() => {})
      .finally(() => setCountsLoading(false))
  }, [])

  async function handleReset() {
    if (!confirmMode) return
    setResetting(true)
    setResetError(null)
    setResetResult(null)
    try {
      const result = await resetApp(confirmMode)
      setResetResult(result)
      setConfirmMode(null)
      setConfirmText('')
      // Refresh counts
      const [folderCounts, sl, saved, arch] = await Promise.all([
        getFolderCounts(), getShortlist(), getSaved(), getArchivedIds()
      ])
      setCounts({
        analyzed: folderCounts.analyzed ?? 0,
        archived: arch.photo_ids?.length ?? 0,
        shortlisted: sl.photo_ids?.length ?? 0,
        saved: saved.photo_ids?.length ?? 0,
        toProcess: folderCounts.to_process ?? 0,
      })
    } catch (err) {
      setResetError(err.message)
    } finally {
      setResetting(false)
    }
  }

  const CONFIRM_WORD = confirmMode === 'full_wipe' ? 'DELETE' : 'RESET'
  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        <p className="page-subtitle">App configuration and data management</p>
      </div>

      {/* ── Reset / New Batch ─────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>Start a New Batch</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Use these options to clear the current batch and start fresh — for example when you want
          to re-upload the same photos plus a few new ones, or completely start over.
        </p>

        {/* Current state summary */}
        {!countsLoading && counts && (
          <div className="reset-counts">
            <div className="reset-count-item">
              <span className="reset-count-num">{counts.analyzed}</span>
              <span className="reset-count-label">Analysed</span>
            </div>
            <div className="reset-count-item">
              <span className="reset-count-num">{counts.archived}</span>
              <span className="reset-count-label">Archived</span>
            </div>
            <div className="reset-count-item">
              <span className="reset-count-num">{counts.shortlisted}</span>
              <span className="reset-count-label">Shortlisted</span>
            </div>
            <div className="reset-count-item">
              <span className="reset-count-num">{counts.saved}</span>
              <span className="reset-count-label">Saved</span>
            </div>
            <div className="reset-count-item">
              <span className="reset-count-num">{counts.toProcess}</span>
              <span className="reset-count-label">To Process</span>
            </div>
          </div>
        )}

        {resetResult && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            {resetResult.mode === 'new_batch'
              ? `Done — ${resetResult.photos_moved} photo${resetResult.photos_moved !== 1 ? 's' : ''} moved back to the upload queue, ${resetResult.runs_deleted} run${resetResult.runs_deleted !== 1 ? 's' : ''} cleared.`
              : `Done — ${resetResult.photos_deleted} photo${resetResult.photos_deleted !== 1 ? 's' : ''} deleted, ${resetResult.runs_deleted} run${resetResult.runs_deleted !== 1 ? 's' : ''} cleared.`
            }
            {' '}
            <button className="btn btn-small btn-primary" onClick={() => navigate('/')} style={{ marginLeft: 8 }}>
              Go to Analyse →
            </button>
            <button onClick={() => setResetResult(null)} className="alert-dismiss">✕</button>
          </div>
        )}

        {resetError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            Reset failed: {resetError}
            <button onClick={() => setResetError(null)} className="alert-dismiss">✕</button>
          </div>
        )}

        <div className="reset-options">
          {/* Option 1: New Batch */}
          <div className={`reset-option-card ${confirmMode === 'new_batch' ? 'reset-option-active' : ''}`}>
            <div className="reset-option-header">
              <div className="reset-option-icon reset-icon-soft">↺</div>
              <div>
                <h3>New Batch</h3>
                <p className="muted">Keep your photos — just re-queue them for analysis</p>
              </div>
            </div>
            <ul className="reset-checklist">
              <li className="reset-check-yes">✓ Moves all analysed &amp; archived photos back to the upload queue</li>
              <li className="reset-check-yes">✓ Clears all analysis runs and results</li>
              <li className="reset-check-yes">✓ Resets shortlist and saved lists</li>
              <li className="reset-check-yes">✓ Clears thumbnails cache</li>
              <li className="reset-check-no">✗ Does NOT delete any photos from disk</li>
              <li className="reset-check-no">✗ Does NOT touch your exported/processed photos</li>
            </ul>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
              After this, go to <strong>Analyse</strong>, add any new photos, and run a fresh batch.
            </p>
            {confirmMode !== 'new_batch' ? (
              <button
                className="btn btn-secondary"
                onClick={() => { setConfirmMode('new_batch'); setConfirmText('') }}
                disabled={resetting}
              >
                New Batch…
              </button>
            ) : (
              <div className="reset-confirm-box">
                <p>Type <strong>RESET</strong> to confirm:</p>
                <div className="reset-confirm-row">
                  <input
                    className="reset-confirm-input"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="RESET"
                    autoFocus
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleReset}
                    disabled={!confirmReady || resetting}
                  >
                    {resetting ? 'Resetting…' : 'Confirm Reset'}
                  </button>
                  <button className="btn btn-small" onClick={() => { setConfirmMode(null); setConfirmText('') }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Option 2: Full Wipe */}
          <div className={`reset-option-card reset-option-danger ${confirmMode === 'full_wipe' ? 'reset-option-active' : ''}`}>
            <div className="reset-option-header">
              <div className="reset-option-icon reset-icon-danger">⚠</div>
              <div>
                <h3>Full Wipe</h3>
                <p className="muted">Delete everything and start completely from scratch</p>
              </div>
            </div>
            <ul className="reset-checklist">
              <li className="reset-check-danger">✗ Permanently deletes ALL photos from analysed, archived, errored &amp; upload queue</li>
              <li className="reset-check-yes">✓ Clears all analysis runs and results</li>
              <li className="reset-check-yes">✓ Resets shortlist and saved lists</li>
              <li className="reset-check-yes">✓ Clears thumbnails cache</li>
              <li className="reset-check-no">✗ Does NOT touch your exported/processed photos</li>
            </ul>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, color: '#f87171' }}>
              This cannot be undone. Only use this if you want to start completely fresh with new photos.
            </p>
            {confirmMode !== 'full_wipe' ? (
              <button
                className="btn btn-danger"
                onClick={() => { setConfirmMode('full_wipe'); setConfirmText('') }}
                disabled={resetting}
              >
                Full Wipe…
              </button>
            ) : (
              <div className="reset-confirm-box">
                <p>Type <strong>DELETE</strong> to confirm permanent deletion:</p>
                <div className="reset-confirm-row">
                  <input
                    className="reset-confirm-input reset-confirm-input-danger"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoFocus
                  />
                  <button
                    className="btn btn-danger"
                    onClick={handleReset}
                    disabled={!confirmReady || resetting}
                  >
                    {resetting ? 'Deleting…' : 'Confirm Delete'}
                  </button>
                  <button className="btn btn-small" onClick={() => { setConfirmMode(null); setConfirmText('') }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Models ────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>AI Models</h2>
        {loading ? (
          <p className="muted">Loading models...</p>
        ) : (
          <div className="models-grid">
            {models.map(model => (
              <div
                key={model.id}
                className={`model-card ${model.id === defaultModel ? 'model-default' : ''}`}
              >
                <div className="model-card-header">
                  <h3>{model.display_name}</h3>
                  {model.id === defaultModel && (
                    <span className="default-badge">Default</span>
                  )}
                </div>
                <p className="model-description">{model.description}</p>
                <div className="model-pricing">
                  <div className="price-row">
                    <span>Input</span>
                    <span>${model.input_per_1m_tokens} / 1M tokens</span>
                  </div>
                  <div className="price-row">
                    <span>Output</span>
                    <span>${model.output_per_1m_tokens} / 1M tokens</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── About ─────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>About</h2>
        <p>
          Photo Analyser v3.0 — AI analyses your dating profile photos and recommends
          the best Lightroom presets, crop, rotation, and AI enhancement for each one.
        </p>
        <p className="muted">
          Your photos are processed locally. Only image data is sent to Google's
          Gemini API for analysis. No photos are stored externally.
        </p>
      </div>
    </div>
  )
}

export default Settings
