#!/usr/bin/env bash
# Idempotent: start FastAPI + Vite if they are not already responding.
# Safe to run from postStartCommand + postAttachCommand (flock avoids races).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK=/tmp/photo-analyser-ensure-dev.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

api_ok() {
  curl -sf -o /dev/null --connect-timeout 1 --max-time 2 "http://127.0.0.1:8000/openapi.json" 2>/dev/null
}

web_ok() {
  curl -sf -o /dev/null --connect-timeout 1 --max-time 2 "http://127.0.0.1:3000/" 2>/dev/null
}

if ! api_ok; then
  echo "[photo-analyser] Starting API on :8000 ..."
  mkdir -p /tmp/photo-analyser-logs
  nohup python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload \
    >> /tmp/photo-analyser-logs/api.log 2>&1 &
  disown 2>/dev/null || true
  for _ in $(seq 1 60); do
    api_ok && break
    sleep 0.5
  done
fi

if ! web_ok; then
  echo "[photo-analyser] Starting frontend on :3000 ..."
  mkdir -p /tmp/photo-analyser-logs
  cd "$ROOT/frontend"
  nohup npm run dev -- --host 0.0.0.0 --port 3000 \
    >> /tmp/photo-analyser-logs/web.log 2>&1 &
  disown 2>/dev/null || true
  sleep 2
  # First `npm run dev` can take a while (deps / Vite cold start)
  for _ in $(seq 1 120); do
    web_ok && break
    sleep 0.5
  done
fi

if api_ok && web_ok; then
  echo "[photo-analyser] Dev servers ready — open http://localhost:3000 (API :8000)"
else
  echo "[photo-analyser] WARNING: one or both servers did not become ready in time."
  echo "[photo-analyser] Logs: /tmp/photo-analyser-logs/api.log and web.log"
  echo "[photo-analyser] Run: bash scripts/ensure-dev-servers.sh"
fi
exit 0
