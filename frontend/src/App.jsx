/*
 * LEARNING NOTE: App.jsx is the "root component" — the top-level container.
 *
 * PYTHON COMPARISON:
 *   In Python/Streamlit, you had one big app.py with all the screens.
 *   In React, each screen is a separate "page component", and App.jsx
 *   is the router that decides which page to show based on the URL.
 *
 * WHAT'S A COMPONENT?
 *   A component is a reusable piece of UI. It's like a Python function
 *   that returns HTML instead of a value.
 *
 *   Python:  def greet(name): return f"Hello {name}"
 *   React:   function Greet({ name }) { return <h1>Hello {name}</h1> }
 *
 * WHAT'S JSX?
 *   JSX is the HTML-like syntax you see below. It looks like HTML but it's
 *   actually JavaScript. React converts it to real HTML behind the scenes.
 */
import { Component } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Analysis from './pages/Analysis'
import Settings from './pages/Settings'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 32,
          background: '#0a0a0f', color: '#e8e8ee', fontFamily: 'system-ui, sans-serif',
          gap: 16, textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem' }}>Something went wrong</div>
          <p style={{ color: '#8888a0', maxWidth: 480 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.href = '/' }}
            style={{
              background: '#4f8ff7', color: '#fff', border: 'none',
              padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
              fontSize: '1rem', fontWeight: 600
            }}
          >
            Back to Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  // Routes define which component shows for which URL path.
  // "/" = Dashboard, "/analysis" = Analysis results, "/settings" = Settings
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analysis/:runId" element={<Analysis />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}

export default App
