import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { analyzeBatch, listRuns, uploadPhotos, getAnalysisProgress, getFolderCounts, deleteRun } from '../api/client'
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
      const [runsData, counts] = await Promise.all([
        listRuns(),
        getFolderCounts(),
      ])
      setRuns(runsData.runs || [])
      setFolderCounts(counts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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
