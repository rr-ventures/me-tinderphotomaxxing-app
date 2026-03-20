import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { analyzeBatch, listRuns, uploadPhotos, getAnalysisProgress, getFolderCounts, deleteRun, resetApp, getShortlist, getSaved, getArchivedIds } from '../api/client'
import ModelSelector from '../components/ModelSelector'
import CostEstimate from '../components/CostEstimate'

function Dashboard() {
  const [folderCounts, setFolderCounts] = useState(null)
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [runs, setRuns] = useState([])
  const [batchLimit, setBatchLimit] = useState(0)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const [analysisProgress, setAnalysisProgress] = useState(null)
  const progressPollRef = useRef(null)

  // New Batch / Reset state
  const [resetCounts, setResetCounts] = useState(null)
  const [confirmMode, setConfirmMode] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState(null)
  const [resetError, setResetError] = useState(null)

  const navigate = useNavigate()

  useEffect(() => {
    loadAll()
    return () => {
      if (progressPollRef.current) clearInterval(progressPollRef.current)
    }
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [runsData, counts, sl, saved, arch] = await Promise.all([
        listRuns(),
        getFolderCounts(),
        getShortlist(),
        getSaved(),
        getArchivedIds(),
      ])
      setRuns(runsData.runs || [])
      setFolderCounts(counts)
      setResetCounts({
        analyzed: counts.analyzed ?? 0,
        archived: arch.photo_ids?.length ?? 0,
        shortlisted: sl.photo_ids?.length ?? 0,
        saved: saved.photo_ids?.length ?? 0,
        toProcess: counts.to_process ?? 0,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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
      await loadAll()
    } catch (err) {
      setResetError(err.message)
    } finally {
      setResetting(false)
    }
  }

  const CONFIRM_WORD = confirmMode === 'full_wipe' ? 'DELETE' : 'RESET'
  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD

  const toProcessCount = folderCounts?.to_process ?? 0

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalysisProgress(null)
    setError(null)

    progressPollRef.current = setInterval(async () => {
      try {
        const p = await getAnalysisProgress()
        if (p.status !== 'idle') setAnalysisProgress(p)
      } catch { /* ignore */ }
    }, 1500)

    try {
      const limit = batchLimit > 0 ? batchLimit : undefined
      const result = await analyzeBatch(model, limit)
      clearInterval(progressPollRef.current)
      navigate(`/analysis/${result.run_id}`)
    } catch (err) {
      clearInterval(progressPollRef.current)
      setError(err.message)
      setAnalyzing(false)
      setAnalysisProgress(null)
    }
  }

  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return
    const imageFiles = [...files].filter(f =>
      /\.(jpe?g|png|webp|heic|tiff|bmp)$/i.test(f.name)
    )
    if (imageFiles.length === 0) {
      setError('No supported image files selected (JPG, PNG, WebP, HEIC, TIFF, BMP)')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    setUploadResult(null)
    setError(null)
    try {
      const result = await uploadPhotos(imageFiles, setUploadProgress)
      setUploadResult(result)
      await loadAll()
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }, [])

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const analyzeCount = batchLimit > 0 ? Math.min(batchLimit, toProcessCount) : toProcessCount

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Photo Analyser</h1>
        <p className="page-subtitle">
          AI-powered Lightroom preset recommendations
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="alert-dismiss">Dismiss</button>
        </div>
      )}

      {uploadResult && (
        <div className={`alert ${uploadResult.skipped > 0 ? 'alert-warning' : 'alert-success'}`}>
          Uploaded {uploadResult.uploaded} photo{uploadResult.uploaded !== 1 ? 's' : ''}
          {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped`}
          <button onClick={() => setUploadResult(null)} className="alert-dismiss">Dismiss</button>
        </div>
      )}

      {/* ── Quick access banner if analyzed photos exist ── */}
      {!loading && folderCounts && folderCounts.analyzed > 0 && (
        <div className="analyzed-banner">
          <div className="analyzed-banner-text">
            <strong>{folderCounts.analyzed} photos</strong> analyzed and ready to review
          </div>
          <Link to="/photos" className="btn btn-primary">
            View Photos →
          </Link>
        </div>
      )}

      {/* ── Analyze ── */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div>
            <h2>Analyze Photos</h2>
            <p className="section-desc">
              {loading ? 'Scanning...' : toProcessCount === 0
                ? 'No photos waiting — upload some below or they may have already been analyzed.'
                : `${toProcessCount} photo${toProcessCount !== 1 ? 's' : ''} ready to analyze.`}
            </p>
          </div>
          {toProcessCount > 0 && (
            <div className="section-badge section-badge-pending">
              {toProcessCount} waiting
            </div>
          )}
        </div>

        <div className="analyze-controls">
          <div className="analyze-controls-row">
            <div className="analyze-model-wrap">
              <ModelSelector selectedModel={model} onModelChange={setModel} />
            </div>

            {toProcessCount > 0 && (
              <div className="analyze-limit-wrap">
                <label className="input-label">Limit (optional)</label>
                <input
                  type="number"
                  min="0"
                  max={toProcessCount}
                  value={batchLimit}
                  onChange={e => setBatchLimit(parseInt(e.target.value) || 0)}
                  className="number-input"
                  placeholder="0 = all"
                />
                <p className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                  {batchLimit > 0 ? `Analyze first ${analyzeCount}` : `Analyze all ${toProcessCount}`}
                </p>
              </div>
            )}

            <div className="analyze-action-wrap">
              {toProcessCount > 0 && <CostEstimate model={model} numImages={analyzeCount} />}
              <button
                onClick={handleAnalyze}
                disabled={analyzing || toProcessCount === 0 || !model}
                className="btn btn-primary btn-large"
              >
                {analyzing ? 'Analyzing...' : toProcessCount === 0 ? 'No Photos to Analyze' : `Analyze ${analyzeCount} Photo${analyzeCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {analyzing && (
            <div className="analysis-progress">
              {analysisProgress ? (
                <>
                  <div className="analysis-progress-header">
                    <span className="analysis-progress-label">
                      {analysisProgress.completed} / {analysisProgress.total} photos
                    </span>
                    <span className="analysis-progress-pct">
                      {analysisProgress.total > 0
                        ? Math.round((analysisProgress.completed / analysisProgress.total) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="analysis-progress-track">
                    <div
                      className="analysis-progress-fill"
                      style={{
                        width: analysisProgress.total > 0
                          ? `${(analysisProgress.completed / analysisProgress.total) * 100}%`
                          : '0%'
                      }}
                    />
                  </div>
                  {analysisProgress.errors > 0 && (
                    <p className="analysis-progress-errors">
                      {analysisProgress.errors} error{analysisProgress.errors !== 1 ? 's' : ''}
                    </p>
                  )}
                  {analysisProgress.log && analysisProgress.log.length > 0 && (
                    <div className="analysis-log">
                      {[...analysisProgress.log].reverse().slice(0, 6).map((line, i) => (
                        <div key={i} className={`analysis-log-line ${line.startsWith('✗') ? 'analysis-log-error' : ''}`}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">Starting analysis...</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 3: Upload ── */}
      <div className="dashboard-section">
        <div className="dashboard-section-header">
          <div>
            <h2>Upload Photos</h2>
            <p className="section-desc">Add new photos to the queue for analysis.</p>
          </div>
        </div>

        <div
          className={`upload-zone ${dragOver ? 'upload-zone-active' : ''} ${uploading ? 'upload-zone-uploading' : ''}`}
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.heic,.tiff,.bmp"
            style={{ display: 'none' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
          {uploading ? (
            <div className="upload-progress">
              <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
              <span className="upload-progress-text">{uploadProgress}% uploading...</span>
            </div>
          ) : (
            <>
              <div className="upload-icon">+</div>
              <p className="upload-text">Drag & drop photos here, or click to browse</p>
              <p className="upload-hint">JPG, PNG, WebP, HEIC, TIFF, BMP</p>
            </>
          )}
        </div>
      </div>

      {/* ── Pipeline status bar ── */}
      {folderCounts && (
        <div className="pipeline-status">
          <div className="pipeline-step pipeline-step-active">
            <span className="pipeline-count">{folderCounts.to_process}</span>
            <span className="pipeline-label">To Process</span>
          </div>
          <span className="pipeline-arrow">→</span>
          <div className="pipeline-step pipeline-step-done">
            <span className="pipeline-count">{folderCounts.analyzed}</span>
            <span className="pipeline-label">Analyzed</span>
          </div>
          {folderCounts.errored > 0 && (
            <>
              <span className="pipeline-arrow pipeline-arrow-error">⚠</span>
              <div className="pipeline-step pipeline-step-error">
                <span className="pipeline-count">{folderCounts.errored}</span>
                <span className="pipeline-label">Errored</span>
              </div>
            </>
          )}
          {folderCounts.archived > 0 && (
            <>
              <span className="pipeline-arrow">·</span>
              <div className="pipeline-step pipeline-step-archived">
                <span className="pipeline-count">{folderCounts.archived}</span>
                <span className="pipeline-label">Archived</span>
              </div>
            </>
          )}
          <button onClick={loadAll} className="btn btn-secondary btn-small pipeline-refresh">
            Refresh
          </button>
        </div>
      )}

      {/* ── New Batch / Reset — collapsed at the bottom ── */}
      <details className="runs-history">
        <summary className="runs-history-summary">
          Start a New Batch / Reset
        </summary>
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginBottom: 16 }}>
            Clear the current batch and start fresh — re-queue photos for re-analysis, or do a full wipe.
          </p>

          {resetCounts && (
            <div className="reset-counts">
              <div className="reset-count-item">
                <span className="reset-count-num">{resetCounts.analyzed}</span>
                <span className="reset-count-label">Analysed</span>
              </div>
              <div className="reset-count-item">
                <span className="reset-count-num">{resetCounts.archived}</span>
                <span className="reset-count-label">Archived</span>
              </div>
              <div className="reset-count-item">
                <span className="reset-count-num">{resetCounts.shortlisted}</span>
                <span className="reset-count-label">Shortlisted</span>
              </div>
              <div className="reset-count-item">
                <span className="reset-count-num">{resetCounts.saved}</span>
                <span className="reset-count-label">Saved</span>
              </div>
              <div className="reset-count-item">
                <span className="reset-count-num">{resetCounts.toProcess}</span>
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
                <li className="reset-check-no">✗ Does NOT delete any photos from disk</li>
              </ul>
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
                    <button className="btn btn-primary" onClick={handleReset} disabled={!confirmReady || resetting}>
                      {resetting ? 'Resetting…' : 'Confirm Reset'}
                    </button>
                    <button className="btn btn-small" onClick={() => { setConfirmMode(null); setConfirmText('') }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`reset-option-card reset-option-danger ${confirmMode === 'full_wipe' ? 'reset-option-active' : ''}`}>
              <div className="reset-option-header">
                <div className="reset-option-icon reset-icon-danger">⚠</div>
                <div>
                  <h3>Full Wipe</h3>
                  <p className="muted">Delete everything and start completely from scratch</p>
                </div>
              </div>
              <ul className="reset-checklist">
                <li className="reset-check-danger">✗ Permanently deletes ALL photos from disk</li>
                <li className="reset-check-yes">✓ Clears all runs, shortlist, saved</li>
                <li className="reset-check-no">✗ Does NOT touch your exported/processed photos</li>
              </ul>
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
                    <button className="btn btn-danger" onClick={handleReset} disabled={!confirmReady || resetting}>
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
      </details>

      {/* ── Past runs — collapsed at the bottom ── */}
      {!loading && runs.length > 0 && (
        <details className="runs-history">
          <summary className="runs-history-summary">
            Past runs ({runs.length})
          </summary>
          <div className="runs-list" style={{ marginTop: 12 }}>
            {runs.map((run, i) => (
              <div
                key={run.run_id}
                className={`run-card ${i === 0 ? 'run-card-latest' : ''}`}
              >
                <div
                  className="run-card-clickable"
                  onClick={() => navigate(`/analysis/${run.run_id}`)}
                >
                  <div className="run-card-header">
                    <div className="run-card-title">
                      {i === 0 && <span className="run-card-badge">Latest</span>}
                      <strong>{run.run_id}</strong>
                    </div>
                    <span className="run-model">{run.model}</span>
                  </div>
                  <div className="run-card-stats">
                    <span className="run-stat-analyzed">{run.total_analyzed} photos</span>
                    {run.total_errors > 0 && (
                      <span className="text-error">{run.total_errors} errors</span>
                    )}
                    <span className="run-stat-cost">${run.estimated_cost_usd?.toFixed(4)}</span>
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-small run-delete-btn"
                  title="Delete this run record (photos are NOT deleted)"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm(`Delete run ${run.run_id}? This removes the run record only — photos stay in the analyzed folder.`)) return
                    try {
                      await deleteRun(run.run_id)
                      await loadAll()
                    } catch (err) {
                      setError(`Delete failed: ${err.message}`)
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default Dashboard
