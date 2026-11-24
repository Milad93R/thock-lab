#!/usr/bin/env bash
# Usage: tests/with-server.sh preview|dev <node test script> [args...]
# Starts a local vite server (niced), runs the test under the shared browser lock, and always
# kills the server afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
kind=${1:?preview|dev}; shift
PORT=6803
if [ "$kind" = "dev" ]; then
  nice -n 15 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $PORT --strictPort >/tmp/thock-vite.log 2>&1 &
else
  nice -n 15 node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port $PORT --strictPort >/tmp/thock-vite.log 2>&1 &
fi
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then break; fi
  sleep 0.5
done
BASE_URL=${BASE_URL:-http://127.0.0.1:$PORT} nice -n 15 flock /tmp/idea-factory-browser.lock node "$@"
