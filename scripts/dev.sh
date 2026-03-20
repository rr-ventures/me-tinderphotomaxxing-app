#!/usr/bin/env bash
# Start backend + frontend for local development.
# From repo root: bash scripts/dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pkill -f "uvicorn backend.main:app" 2>/dev/null || true
pkill -f "vite.*3000" 2>/dev/null || true
sleep 1

echo "Starting API on http://0.0.0.0:8000 ..."
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
API_PID=$!

echo "Starting Vite on http://0.0.0.0:3000 ..."
cd frontend
npm run dev -- --host 0.0.0.0 --port 3000 &
WEB_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Frontend: http://localhost:3000"
echo "  API:      http://localhost:8000"
echo ""
echo "  Dev Container / Codespaces: open the PORTS tab,"
echo "  ensure 3000 is forwarded, then use the forwarded URL."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Press Ctrl+C to stop both."
echo ""

trap 'kill $API_PID $WEB_PID 2>/dev/null; exit 0' INT TERM
wait
