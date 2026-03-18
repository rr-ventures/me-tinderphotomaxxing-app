#!/bin/bash
# Start backend and frontend in the background when the devcontainer starts.
cd /workspaces/me-imageanalyser-app

# Start backend
nohup uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 --reload-exclude "frontend/*" > /tmp/backend.log 2>&1 &

# Start frontend (host: true in vite.config.js binds to 0.0.0.0)
cd frontend && nohup npm run dev > /tmp/frontend.log 2>&1 &

echo "App servers starting. Frontend: http://localhost:3000  Backend: http://localhost:8000"
