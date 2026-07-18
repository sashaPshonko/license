#!/bin/bash
cd "$(dirname "$0")/../.." || exit 1

LOCK_FILE="/tmp/botpodpopcorn-license.lock"
exec 8>"$LOCK_FILE"
if ! flock -n 8; then
    echo "[license] уже запущен (flock $LOCK_FILE)"
    echo "[license] остановить: bash scripts/run/stop.sh"
    exit 1
fi

echo "[license] wrapper pid $$ — server loop"
echo "[license] cwd $(pwd)"

while true; do
    node src/server.mjs
    code=$?
    echo "[license] server exited code=$code — рестарт через 5с"
    sleep 5
done
