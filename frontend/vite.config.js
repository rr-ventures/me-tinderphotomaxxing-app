import dns from 'node:dns'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Avoid IPv4/IPv6 "localhost" ordering surprises (Docker / WSL / dev containers).
// See: https://vite.dev/config/server-options.html#server-host
dns.setDefaultResultOrder('verbatim')

// https://vite.dev/config/
//
// LEARNING NOTE: Vite is the "build tool" for our React app.
// It does two things:
// 1. During development: runs a fast dev server with hot reload
// 2. For production: bundles all your JS/CSS into optimized files
//
// The "proxy" below is important: when the React app calls /api/...,
// Vite forwards those requests to our FastAPI backend on port 8000.
// This avoids CORS issues during development.
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so Dev Container port forwarding can reach the server.
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Vite 7 blocks unknown Host headers by default; forwarded URLs (Codespaces, proxies)
    // use hostnames that are not "localhost", which can cause ERR_EMPTY_RESPONSE.
    // This project is local/dev only — do not copy to public-facing deployments.
    allowedHosts: true,
    watch: {
      // Reliable file events when the workspace is on Docker Desktop / WSL mounts
      usePolling: true,
      interval: 1000,
    },
    hmr: {
      // Keep HMR on the same port as the page when using simple port forwards
      clientPort: 3000,
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/thumbnails': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
