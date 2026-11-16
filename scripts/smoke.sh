#!/usr/bin/env bash
# Runs the end-to-end smoke test twice against a throwaway data folder:
# phase 1 exercises the UI, phase 2 relaunches to check everything persisted.
# On Linux it needs Xvfb (xvfb-run). On Windows, run the two electron
# commands directly in Git Bash with the same environment variables.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${SMOKE_OUT_DIR:-$(mktemp -d)}"; mkdir -p "$OUT"
export STICKY_SMOKE_TEST=1 STICKY_DATA_DIR="$OUT/data" STICKY_SMOKE_OUT="$OUT"
export STICKY_FOCUS_MS=3000 STICKY_BREAK_MS=1200   # shortened focus-timer phases, test only
npx vite build >/dev/null
RUN=(npx electron .)
if [[ "$(uname)" == "Linux" ]]; then RUN=(xvfb-run -a -s "-screen 0 1920x1080x24" npx electron . --no-sandbox); fi
STICKY_SMOKE_PHASE=1 "${RUN[@]}"
STICKY_SMOKE_PHASE=2 "${RUN[@]}"
echo "Screenshots and results: $OUT"
# Layout checks for the collapsed strip and the header ticker (fresh profile).
SMOKE_OUT_DIR="$OUT" ./scripts/smoke-ui.sh
