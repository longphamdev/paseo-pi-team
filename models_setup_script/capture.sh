#!/usr/bin/env bash
# capture.sh — re-sync this folder from the LIVE configs (opposite of apply.sh).
#   ~/.pi/agent/models.json   -> pi-models.json
#   ~/.paseo/config.json      -> paseo-config.json
# Use after editing the live files so this folder stays the source of truth.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_MODELS_SRC="$HOME/.pi/agent/models.json"
PASEO_SRC="$HOME/.paseo/config.json"
PI_MODELS_DST="$SCRIPT_DIR/pi-models.json"
PASEO_DST="$SCRIPT_DIR/paseo-config.json"

for pair in "$PI_MODELS_SRC:$PI_MODELS_DST" "$PASEO_SRC:$PASEO_DST"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  if [ ! -f "$src" ]; then echo "WARNING: $src not found, skipped" >&2; continue; fi
  cp "$src" "$dst"
  echo "captured $src -> $dst"
done
