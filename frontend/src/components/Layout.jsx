/*
 * LEARNING NOTE: Layout component — the shell that wraps every page.
 *
 * PYTHON COMPARISON:
 *   In Streamlit, the sidebar and title were part of every screen function.
 *   In React, we create a Layout component that wraps all pages.
 *   The navigation bar appears on every page without repeating code.
 *
 * WHAT'S <Outlet />?
 *   It's a placeholder that says "render the current page here."
 *   When you navigate to "/", it renders <Dashboard />.
 *   When you navigate to "/analysis/123", it renders <Analysis />.
 *   The Layout (nav bar) stays the same — only the content changes.
 */
import { Outlet, Link, useLocation } from 'react-router-dom'

function Layout() {
  // useLocation() tells us what page we're currently on
  const location = useLocation()

  // Helper to check if a nav link is active (for highlighting)
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="app-layout">
      {/* Navigation bar at the top */}
      <nav className="nav-bar">
        <div className="nav-brand">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="nav-logo">Photo Analyser</span>
          </Link>
        </div>

        <div className="nav-links">
          <Link
            to="/"
            className={`nav-link ${isActive('/') && !location.pathname.startsWith('/analysis') ? 'active' : ''}`}
          >
            Dashboard
          </Link>
          {location.pathname.startsWith('/analysis') && (
            <span className="nav-link active">Results</span>
          )}
        </div>
      </nav>

      {/* Page content renders here */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
