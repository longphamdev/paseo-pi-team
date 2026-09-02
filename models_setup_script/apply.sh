#!/usr/bin/env bash
# apply.sh — copy the bundled configs in this folder OVER the live ones.
#   pi-models.json  -> ~/.pi/agent/models.json
#   paseo-config.json -> ~/.paseo/config.json
# Existing live files are backed up with a timestamp before being overwritten.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_MODELS_SRC="$SCRIPT_DIR/pi-models.json"
PASEO_SRC="$SCRIPT_DIR/paseo-config.json"
PI_MODELS_DST="$HOME/.pi/agent/models.json"
PASEO_DST="$HOME/.paseo/config.json"

ts() { date +%Y%m%d-%H%M%S; }

require_json() {
  local f="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
      || { echo "ERROR: $f is not valid JSON" >&2; return 1; }
  fi
  return 0
}

require_json "$PI_MODELS_SRC" || exit 1
require_json "$PASEO_SRC" || exit 1

mkdir -p "$(dirname "$PI_MODELS_DST")" "$(dirname "$PASEO_DST")"

backup() {
  local dst="$1"
  if [ -f "$dst" ]; then
    cp "$dst" "$dst.bak-$(ts)"
    echo "backed up -> $dst.bak-$(ts)"
  fi
}

backup "$PI_MODELS_DST"
backup "$PASEO_DST"

cp "$PI_MODELS_SRC" "$PI_MODELS_DST"
cp "$PASEO_SRC" "$PASEO_DST"

echo "Applied:"
echo "  $PI_MODELS_DST"
echo "  $PASEO_DST"
echo "Restart the Paseo daemon (127.0.0.1:6767) for changes to take effect."
