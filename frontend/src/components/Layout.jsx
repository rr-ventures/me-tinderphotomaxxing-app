import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { getFolderCounts, getSaved, getShortlist } from '../api/client'

function Layout() {
  const location = useLocation()
  const [analyzedCount, setAnalyzedCount] = useState(null)
  const [shortlistCount, setShortlistCount] = useState(null)
  const [savedCount, setSavedCount] = useState(null)

  useEffect(() => {
    async function loadCounts() {
      try {
        const [counts, saved, sl] = await Promise.all([getFolderCounts(), getSaved(), getShortlist()])
        setAnalyzedCount(counts.analyzed ?? null)
        setSavedCount((saved.photo_ids || []).length)
        setShortlistCount((sl.photo_ids || []).length)
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
          <Link to="/saved" className={`nav-link ${isActive('/saved') ? 'active' : ''}`}>
            Saved
            {savedCount != null && savedCount > 0 && (
              <span className="nav-badge nav-badge-saved">{savedCount}</span>
            )}
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
