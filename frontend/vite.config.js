import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/thumbnails': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
