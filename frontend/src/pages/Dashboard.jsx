/*
 * LEARNING NOTE: Dashboard — the home page / main screen.
 *
 * This page handles:
 * 1. Scanning for photos in to_process/
 * 2. Letting you choose the AI model
 * 3. Starting analysis (single or batch)
 * 4. Showing past runs
 *
 * REACT STATE MANAGEMENT:
 *   This component has several pieces of state:
 *   - photos: the list of photos found in to_process/
 *   - model: which Gemini model to use
 *   - analyzing: whether analysis is currently running
 *   - error: any error message to display
 *
 *   Each piece of state is independent. When one changes,
 *   React only re-renders the parts of the UI that depend on it.
 *
 * ASYNC/AWAIT IN REACT:
 *   API calls in React work the same as in Python:
 *   Python:  result = await analyze_batch(model, limit)
 *   JS:     const result = await analyzeBatch(model, limit)
 *
 *   The difference: in React, we call these inside useEffect() or
 *   event handlers, and update state when the response arrives.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPhotos, analyzeBatch, listRuns, uploadPhotos } from '../api/client'
import PhotoGrid from '../components/PhotoGrid'
import ModelSelector from '../components/ModelSelector'
import CostEstimate from '../components/CostEstimate'

function Dashboard() {
  const [photos, setPhotos] = useState([])
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

  const navigate = useNavigate()

  useEffect(() => {
    loadPhotos()
    loadRuns()
  }, [])

  async function loadPhotos() {
    setLoading(true)
    setError(null)
    try {
      const data = await listPhotos()
      setPhotos(data.photos || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadRuns() {
    try {
      const data = await listRuns()
      setRuns(data.runs || [])
    } catch {
      // Past runs are non-critical, ignore errors
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const limit = batchLimit > 0 ? batchLimit : undefined
      const result = await analyzeBatch(model, limit)
      // Redirect to the analysis results page
      navigate(`/analysis/${result.run_id}`)
    } catch (err) {
      setError(err.message)
      setAnalyzing(false)
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
      await loadPhotos()
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

  function handleDragOver(e) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setDragOver(false)
  }

  const photoCount = photos.length

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">
          AI-powered Lightroom preset recommendations for dating profile photos
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="alert-dismiss">Dismiss</button>
        </div>
      )}

      <div
        className={`upload-zone ${dragOver ? 'upload-zone-active' : ''} ${uploading ? 'upload-zone-uploading' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.heic,.tiff,.bmp"
          style={{ display: 'none' }}
          onChange={e => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {uploading ? (
          <div className="upload-progress">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            <span className="upload-progress-text">{uploadProgress}% uploading...</span>
          </div>
        ) : (
          <>
            <div className="upload-icon">+</div>
            <p className="upload-text">
              Drag & drop photos here, or click to browse
            </p>
            <p className="upload-hint">
              JPG, PNG, WebP, HEIC, TIFF, BMP — up to hundreds of photos at once
            </p>
          </>
        )}
      </div>

      {uploadResult && (
        <div className={`alert ${uploadResult.skipped > 0 ? 'alert-warning' : 'alert-success'}`}>
          Uploaded {uploadResult.uploaded} photo{uploadResult.uploaded !== 1 ? 's' : ''}
          {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped`}
          <button onClick={() => setUploadResult(null)} className="alert-dismiss">Dismiss</button>
        </div>
      )}

      <div className="dashboard-controls">
        <div className="control-card">
          <h2>Photos</h2>
          {loading ? (
            <p className="muted">Scanning for photos...</p>
          ) : (
            <>
              <div className="stat-big">{photoCount}</div>
              <p className="muted">photos in to_process/</p>
              <button onClick={loadPhotos} className="btn btn-secondary">
                Refresh
              </button>
            </>
          )}
        </div>

        <div className="control-card">
          <h2>Model</h2>
          <ModelSelector
            selectedModel={model}
            onModelChange={setModel}
          />
        </div>

        <div className="control-card">
          <h2>Batch Size</h2>
          <input
            type="number"
            min="0"
            max={photoCount}
            value={batchLimit}
            onChange={e => setBatchLimit(parseInt(e.target.value) || 0)}
            className="number-input"
            placeholder="0 = all"
          />
          <p className="muted">
            {batchLimit > 0
              ? `Analyze first ${batchLimit} of ${photoCount} photos`
              : `Analyze all ${photoCount} photos`}
          </p>
          <CostEstimate
            model={model}
            numImages={batchLimit > 0 ? batchLimit : photoCount}
          />
        </div>

        <div className="control-card">
          <h2>Go</h2>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || photoCount === 0 || !model}
            className="btn btn-primary btn-large"
          >
            {analyzing ? 'Analyzing...' : `Analyze ${batchLimit > 0 ? batchLimit : photoCount} Photos`}
          </button>
          {analyzing && (
            <p className="muted">
              This may take a minute. Results will appear when ready.
            </p>
          )}
        </div>
      </div>

      {/* Past runs */}
      {runs.length > 0 && (
        <div className="section">
          <h2>Past Runs</h2>
          <div className="runs-list">
            {runs.map(run => (
              <div
                key={run.run_id}
                className="run-card"
                onClick={() => navigate(`/analysis/${run.run_id}`)}
              >
                <div className="run-card-header">
                  <strong>{run.run_id}</strong>
                  <span className="run-model">{run.model}</span>
                </div>
                <div className="run-card-stats">
                  <span>{run.total_analyzed} analyzed</span>
                  {run.total_errors > 0 && (
                    <span className="text-error">{run.total_errors} errors</span>
                  )}
                  <span>${run.estimated_cost_usd?.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid preview */}
      {photos.length > 0 && !analyzing && (
        <div className="section">
          <h2>Photos Preview</h2>
          <PhotoGrid photos={photos} />
        </div>
      )}

      {!loading && photos.length === 0 && (
        <div className="empty-state-large">
          <h2>No photos found</h2>
          <p>
            Use the upload area above to add your photos, or drop them into <code>data/to_process/</code> directly.
          </p>
        </div>
      )}
    </div>
  )
}

export default Dashboard
