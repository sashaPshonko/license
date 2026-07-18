#!/bin/bash
cd "$(dirname "$0")/../.." || exit 1

echo "[stop] останавливаю license…"

pkill -f 'scripts/run/license.sh' 2>/dev/null || true
pkill -f 'run/license.sh' 2>/dev/null || true
sleep 1
pkill -f 'src/server.mjs' 2>/dev/null || true
sleep 1
pkill -9 -f 'scripts/run/license.sh' 2>/dev/null || true
pkill -9 -f 'src/server.mjs' 2>/dev/null || true

# если порт занят чем-то ещё
if command -v lsof >/dev/null 2>&1; then
    kill $(lsof -t -i :8787) 2>/dev/null || true
fi

sleep 1
left=$(ps aux | grep -E 'run/license\.sh|src/server\.mjs' | grep -v grep || true)
if [ -n "$left" ]; then
    echo "[stop] ещё живы:"
    echo "$left"
else
    echo "[stop] license остановлен"
fi
