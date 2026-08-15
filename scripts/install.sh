#!/usr/bin/env bash
# install.sh — install the paseo-pi-team role pack into the current user's pi config.
#
# Copies:
#   extensions/paseo-team-policy.ts -> ~/.pi/agent/extensions/
#   prompts/*.md                   -> ~/.pi/agent/extensions/prompts/
#   skills/paseo-team-lead/         -> ~/.pi/agent/skills/paseo-team-lead/
#   config/paseo.config.json       -> ~/.paseo/config.json (overrides current)
#
# Also installs the Semble code-search CLI + Pi MCP extension and merges the
# `semble` MCP server entry (idempotent, preserves every other server).

set -euo pipefail

ROLE_PACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOME="${PI_HOME:-$HOME/.pi}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$PI_HOME/agent}"

EXT_DIR="$AGENT_DIR/extensions"
PROMPT_DIR="$EXT_DIR/prompts"
SKILLS_DIR="$AGENT_DIR/skills"
SKILL_DIR="$SKILLS_DIR/paseo-team-lead"
OCR_SKILL_DIR="$SKILLS_DIR/paseo-ocr-reviewer"
TEAM_SCRIPTS_DIR="$EXT_DIR/paseo-team-scripts"
TEAM_SUPPORT_FILES=(
  reliability.mjs
  watchdog.mjs
  team-communication.mjs
  ocr-review.mjs
  remote-paseo.mjs
  model-routing.mjs
  team-scripts-path.mjs
)

mkdir -p "$EXT_DIR" "$PROMPT_DIR" "$SKILLS_DIR"
# Routing configs live here (model-routing.local.json, cluster-routing.local.json);
# create it so the documented copy commands work out of the box.
mkdir -p "$HOME/.paseo-pi-team"
# Override the Paseo daemon config with the role pack's canonical config
# (Pi providers + MCP injection into pi-supervisor/pi-lead/pi-peer).
mkdir -p "$HOME/.paseo"
cp -f "$ROLE_PACK_ROOT/config/paseo.config.json" "$HOME/.paseo/config.json"

cp -f "$ROLE_PACK_ROOT/extensions/paseo-team-policy.ts" "$EXT_DIR/paseo-team-policy.ts"
cp -f "$ROLE_PACK_ROOT"/prompts/*.md "$PROMPT_DIR/"
rm -rf "$SKILL_DIR"
cp -R "$ROLE_PACK_ROOT/skills/paseo-team-lead" "$SKILL_DIR"
rm -rf "$OCR_SKILL_DIR"
cp -R "$ROLE_PACK_ROOT/skills/paseo-ocr-reviewer" "$OCR_SKILL_DIR"
rm -rf "$TEAM_SCRIPTS_DIR"
mkdir -p "$TEAM_SCRIPTS_DIR"
for support_file in "${TEAM_SUPPORT_FILES[@]}"; do
  cp -f "$ROLE_PACK_ROOT/scripts/$support_file" "$TEAM_SCRIPTS_DIR/"
done

# Install and verify the pinned OCR dependency before browser setup.
if ! node "$ROLE_PACK_ROOT/scripts/ocr-setup.mjs"; then
  echo "[paseo-team] OCR setup failed" >&2
  exit 1
fi
# agent-browser is a CLI + bundled skill + stdio MCP server. The helper is
# idempotent and merges only the missing agent-browser entry in Pi's MCP config.
BROWSER_SETUP_ARGS=(--install)
if [[ -z "${PI_CODING_AGENT_DIR:-}" ]]; then
  BROWSER_SETUP_ARGS+=(--pi-home "$PI_HOME")
fi
if ! node "$ROLE_PACK_ROOT/scripts/browser-setup.mjs" "${BROWSER_SETUP_ARGS[@]}"; then
  echo "[paseo-team] agent-browser setup failed" >&2
  exit 1
fi
# The vision MCP server is a stdio MCP server bundled in mcps/vision_mcp. The
# helper copies it into the pi agent dir and merges only the missing vision
# entry in Pi's MCP config (idempotent, preserves every other server).
VISION_SETUP_ARGS=(--install)
if [[ -z "${PI_CODING_AGENT_DIR:-}" ]]; then
  VISION_SETUP_ARGS+=(--pi-home "$PI_HOME")
fi
if ! node "$ROLE_PACK_ROOT/scripts/vision-setup.mjs" "${VISION_SETUP_ARGS[@]}"; then
  echo "[paseo-team] vision MCP setup failed" >&2
  exit 1
fi
# Semble is a code-search CLI + stdio MCP server. The helper installs the CLI
# (uv tool install semble), Pi's MCP extension (pi install npm:pi-mcp-extension)
# and merges only the missing semble entry in Pi's MCP config (idempotent,
# preserves every other server).
SEMBLE_SETUP_ARGS=(--install)
if [[ -z "${PI_CODING_AGENT_DIR:-}" ]]; then
  SEMBLE_SETUP_ARGS+=(--pi-home "$PI_HOME")
fi
if ! node "$ROLE_PACK_ROOT/scripts/semble-setup.mjs" "${SEMBLE_SETUP_ARGS[@]}"; then
  echo "[paseo-team] semble MCP setup failed" >&2
  exit 1
fi

echo ""
echo "[paseo-team] Installed:"
echo "  extension -> $EXT_DIR/paseo-team-policy.ts"
echo "  prompts   -> $PROMPT_DIR"
echo "  lead skill -> $SKILL_DIR"
echo "  OCR skill  -> $OCR_SKILL_DIR"
echo "  vision MCP -> $AGENT_DIR/mcps/vision_mcp"
echo "  semble MCP -> $AGENT_DIR/mcp.json (uvx --from semble[mcp] semble)"
echo "  paseo cfg  -> $HOME/.paseo/config.json"
echo "  support   -> $TEAM_SCRIPTS_DIR"
export PASEO_TEAM_SCRIPTS_DIR="$TEAM_SCRIPTS_DIR"
echo "  support env -> PASEO_TEAM_SCRIPTS_DIR=$TEAM_SCRIPTS_DIR (current process)"
echo "  support default -> \${PI_CODING_AGENT_DIR:-\$HOME/.pi/agent}/extensions/paseo-team-scripts"
echo "  env override is optional; no shell profile mutation is required"
echo ""
echo "Next steps:"
echo "  1. The installer checked/installed OCR (capability-probed; >= v1.8.10 kept as-is, pinned v1.9.2 when repairing), agent-browser CLI, Chrome runtime, skill, vision MCP server and Pi MCP config."
echo "     Vision MCP: server at $AGENT_DIR/mcps/vision_mcp; set VISION_API_KEY (plus optional VISION_API_BASE/VISION_MODEL) in pi's shell environment so read_image can reach the vision model."
echo "  2. Verify OCR if needed: command -v ocr; ocr version"
echo "  3. Install the MCP adapter (PINNED version — Paseo tools depend on it):"
echo "     pi install npm:pi-mcp-adapter@2.19.0"
echo "  4. ~/.paseo/config.json was overridden from config/paseo.config.json"
echo "     (agents.providers.pi-* enabled + daemon.mcp.injectIntoAgents: true)."
echo "  5. Copy config/model-routing.example.json to ~/.paseo-pi-team/model-routing.local.json"
echo "     and fill in REAL model IDs from: paseo provider models pi-peer --json"
echo "     Cross-host controller: also copy config/cluster-routing.example.json to"
echo "     ~/.paseo-pi-team/cluster-routing.local.json (endpoint values live in env)"
echo "  6. Restart the Paseo daemon (kills running agents — do it when ready)."
echo "  7. In pi, run /reload to load the new extension, then /team-role."
echo "  8. Verify host readiness (repo-root independent):"
echo "     node \"$ROLE_PACK_ROOT/scripts/preflight.mjs\""
