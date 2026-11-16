#!/usr/bin/env bash
# Layout checks for the collapsed note strip, on a fresh first-run profile.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${SMOKE_OUT_DIR:-$(mktemp -d)}"; mkdir -p "$OUT"
export STICKY_SMOKE_TEST=1 STICKY_DATA_DIR="$OUT/data-ui" STICKY_SMOKE_OUT="$OUT" STICKY_SMOKE_PHASE=ui
rm -rf "$STICKY_DATA_DIR"
npx vite build >/dev/null
RUN=(npx electron .)
if [[ "$(uname)" == "Linux" ]]; then RUN=(xvfb-run -a -s "-screen 0 1920x1080x24" npx electron . --no-sandbox); fi
"${RUN[@]}"
