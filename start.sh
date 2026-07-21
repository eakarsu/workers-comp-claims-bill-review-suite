#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-5609}"
HOST="${HOST:-127.0.0.1}"
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [ -n "$PIDS" ]; then
    echo "Error: port $PORT is already in use; refusing to terminate another process." >&2
    exit 1
  fi
fi
cd "$(dirname "$0")"
echo "Starting Workers Comp Claims Bill Review Suite on http://$HOST:$PORT"
PORT="$PORT" HOST="$HOST" exec node server.js
