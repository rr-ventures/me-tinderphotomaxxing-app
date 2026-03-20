import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { getFolderCounts, getSaved, getShortlist, getArchivedIds } from '../api/client'

function Layout() {
  const location = useLocation()
  const [analyzedCount, setAnalyzedCount] = useState(null)
  const [shortlistCount, setShortlistCount] = useState(null)
  const [archivedCount, setArchivedCount] = useState(null)
  const [savedCount, setSavedCount] = useState(null)

  useEffect(() => {
    async function loadCounts() {
      try {
        const [counts, saved, sl, arch] = await Promise.all([getFolderCounts(), getSaved(), getShortlist(), getArchivedIds()])
        // Match /photos merged list: scan includes to_process + analyzed (see list_photos without run_id).
        const pipeline = (counts.to_process ?? 0) + (counts.analyzed ?? 0)
        setAnalyzedCount(pipeline > 0 ? pipeline : null)
        setSavedCount((saved.photo_ids || []).length)
        setShortlistCount((sl.photo_ids || []).length)
        setArchivedCount((arch.photo_ids || []).length)
      } catch { /* ignore */ }
    }
    loadCounts()
  }, [location.pathname])

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="app-layout">
      <nav className="nav-bar">
        <div className="nav-brand">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="nav-logo">Photo Analyser</span>
          </Link>
        </div>

        <div className="nav-links">
          <Link to="/" className={`nav-link ${isActive('/') && !isActive('/photos') && !isActive('/shortlist') && !isActive('/saved') && !isActive('/analysis') ? 'active' : ''}`}>
            Analyze
          </Link>
          <Link to="/photos" className={`nav-link ${isActive('/photos') || isActive('/analysis') ? 'active' : ''}`}>
            Photos
            {analyzedCount != null && analyzedCount > 0 && (
              <span className="nav-badge">{analyzedCount}</span>
            )}
          </Link>
          <Link to="/shortlist" className={`nav-link ${isActive('/shortlist') ? 'active' : ''}`}>
            Shortlist
            {shortlistCount != null && shortlistCount > 0 && (
              <span className="nav-badge nav-badge-shortlist">{shortlistCount}</span>
            )}
          </Link>
          <Link to="/archived" className={`nav-link ${isActive('/archived') ? 'active' : ''}`}>
            Archived
            {archivedCount != null && archivedCount > 0 && (
              <span className="nav-badge nav-badge-archived">{archivedCount}</span>
            )}
          </Link>
          <Link to="/saved" className={`nav-link ${isActive('/saved') ? 'active' : ''}`}>
            Saved
            {savedCount != null && savedCount > 0 && (
              <span className="nav-badge nav-badge-saved">{savedCount}</span>
            )}
          </Link>
          <Link to="/settings" className={`nav-link ${isActive('/settings') ? 'active' : ''}`}>
            Settings
          </Link>
        </div>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
