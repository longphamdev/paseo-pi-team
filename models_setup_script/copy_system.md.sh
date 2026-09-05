#!/usr/bin/env bash
set -euo pipefail

# Copy models_setup_script/pi/SYSTEM.md -> ~/.pi/agent/SYSTEM.md
# Idempotent, backs up any existing target, prints a summary.
# Source defaults to a path relative to this script's own location, so it
# works no matter where it's invoked from.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${1:-$SCRIPT_DIR/pi/SYSTEM.md}"
DEST="$HOME/.pi/agent/SYSTEM.md"

if [[ ! -f "$SRC" ]]; then
  echo "error: source not found: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"

# Back up existing target before overwriting (only if it differs)
if [[ -f "$DEST" ]] && ! cmp -s "$SRC" "$DEST"; then
  cp "$DEST" "$DEST.bak.$(date +%Y%m%d_%H%M%S)"
  echo "backup written: $DEST.bak.*"
fi

cp "$SRC" "$DEST"

echo "copied -> $DEST"
if [[ -f "$DEST" ]]; then
  echo "size: $(wc -c < "$DEST") bytes"
fi
