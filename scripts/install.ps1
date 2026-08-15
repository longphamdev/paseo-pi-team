# install.ps1 - install the paseo-pi-team role pack into the current user's pi config.
#
# Copies:
#   extensions/paseo-team-policy.ts -> ~/.pi/agent/extensions/
#   prompts/*.md                   -> ~/.pi/agent/extensions/prompts/
#   skills/paseo-team-lead/         -> ~/.pi/agent/skills/paseo-team-lead/
#   config/paseo.config.json       -> ~/.paseo/config.json (overrides current)
#
# Also installs the Semble code-search CLI + Pi MCP extension and merges the
# `semble` MCP server entry (idempotent, preserves every other server).

param(
  [string]$PiHome = "$env:USERPROFILE\.pi",
  [string]$RolePackRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$agentDir = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $PiHome "agent" }
$extDir    = Join-Path $agentDir "extensions"
$promptDir = Join-Path $extDir "prompts"
$skillsDir = Join-Path $agentDir "skills"
$skillDir  = Join-Path $skillsDir "paseo-team-lead"
$ocrSkillDir = Join-Path $skillsDir "paseo-ocr-reviewer"
$teamScriptsDir = Join-Path $extDir "paseo-team-scripts"
$teamSupportFiles = @(
  "reliability.mjs",
  "watchdog.mjs",
  "team-communication.mjs",
  "ocr-review.mjs",
  "remote-paseo.mjs",
  "model-routing.mjs",
  "team-scripts-path.mjs"
)

New-Item -ItemType Directory -Force -Path $extDir, $promptDir, $skillsDir | Out-Null
# Routing configs live in ~/.paseo-pi-team (model-routing.local.json, cluster-routing.local.json).
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.paseo-pi-team" | Out-Null
# Override the Paseo daemon config with the role pack's canonical config
# (Pi providers + MCP injection into pi-supervisor/pi-lead/pi-peer).
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.paseo" | Out-Null
Copy-Item (Join-Path $RolePackRoot "config\paseo.config.json") "$env:USERPROFILE\.paseo\config.json" -Force

Copy-Item (Join-Path $RolePackRoot "extensions\paseo-team-policy.ts") (Join-Path $extDir "paseo-team-policy.ts") -Force
Copy-Item (Join-Path $RolePackRoot "prompts\*.md") $promptDir -Force
# Replace skill directories deterministically; Copy-Item -Recurse otherwise
# merges stale files and can create nested directories on repeated installs.
if (Test-Path $skillDir) { Remove-Item -Recurse -Force $skillDir }
if (Test-Path $ocrSkillDir) { Remove-Item -Recurse -Force $ocrSkillDir }
Copy-Item -Recurse -Force (Join-Path $RolePackRoot "skills\paseo-team-lead") $skillDir
Copy-Item -Recurse -Force (Join-Path $RolePackRoot "skills\paseo-ocr-reviewer") $ocrSkillDir
if (Test-Path $teamScriptsDir) { Remove-Item -Recurse -Force $teamScriptsDir }
New-Item -ItemType Directory -Force -Path $teamScriptsDir | Out-Null
foreach ($supportFile in $teamSupportFiles) {
  Copy-Item (Join-Path $RolePackRoot "scripts\$supportFile") $teamScriptsDir -Force
}

# agent-browser is a CLI + bundled skill + stdio MCP server. The helper is
# idempotent and merges only the missing agent-browser entry in Pi's MCP config.
& node (Join-Path $RolePackRoot "scripts\ocr-setup.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "OCR setup failed with exit code $LASTEXITCODE"
}
$browserSetupArgs = @("--install")
if (-not $env:PI_CODING_AGENT_DIR) { $browserSetupArgs += @("--pi-home", $PiHome) }
& node (Join-Path $RolePackRoot "scripts\browser-setup.mjs") @browserSetupArgs
if ($LASTEXITCODE -ne 0) {
  throw "agent-browser setup failed with exit code $LASTEXITCODE"
}
$visionSetupArgs = @("--install")
if (-not $env:PI_CODING_AGENT_DIR) { $visionSetupArgs += @("--pi-home", $PiHome) }
& node (Join-Path $RolePackRoot "scripts\vision-setup.mjs") @visionSetupArgs
if ($LASTEXITCODE -ne 0) {
  throw "vision MCP setup failed with exit code $LASTEXITCODE"
}
# Semble is a code-search CLI + stdio MCP server. The helper installs the CLI
# (uv tool install semble), Pi's MCP extension (pi install npm:pi-mcp-extension)
# and merges only the missing semble entry in Pi's MCP config (idempotent,
# preserves every other server).
$sembleSetupArgs = @("--install")
if (-not $env:PI_CODING_AGENT_DIR) { $sembleSetupArgs += @("--pi-home", $PiHome) }
& node (Join-Path $RolePackRoot "scripts\semble-setup.mjs") @sembleSetupArgs
if ($LASTEXITCODE -ne 0) {
  throw "semble MCP setup failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "[paseo-team] Installed:"
Write-Host "  extension -> $extDir\paseo-team-policy.ts"
Write-Host "  prompts   -> $promptDir"
Write-Host "  lead skill -> $skillDir"
Write-Host "  OCR skill  -> $ocrSkillDir"
Write-Host "  vision MCP -> $agentDir\mcps\vision_mcp"
Write-Host "  semble MCP -> $agentDir\mcp.json (uvx --from semble[mcp] semble)"
Write-Host "  paseo cfg  -> $env:USERPROFILE\.paseo\config.json"
Write-Host "  support   -> $teamScriptsDir"
$env:PASEO_TEAM_SCRIPTS_DIR = $teamScriptsDir
Write-Host "  support env -> PASEO_TEAM_SCRIPTS_DIR=$teamScriptsDir (current process only)"
Write-Host "  support default -> `$env:PI_CODING_AGENT_DIR\extensions\paseo-team-scripts or `$env:USERPROFILE\.pi\agent\extensions\paseo-team-scripts"
Write-Host "  env override is optional; no user-profile mutation is required"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. The installer checked/installed OCR (capability-probed; >= v1.8.10 kept as-is, pinned v1.9.2 when repairing), agent-browser CLI, Chrome runtime, skill, vision MCP server and Pi MCP config."
Write-Host "     Vision MCP: server at $agentDir\mcps\vision_mcp; set VISION_API_KEY (plus optional VISION_API_BASE/VISION_MODEL) in pi's shell environment so read_image can reach the vision model."
Write-Host "  2. Verify OCR if needed: Get-Command ocr; ocr version"
Write-Host "  3. Install the MCP adapter (PINNED version - Paseo tools depend on it):"
Write-Host "     pi install npm:pi-mcp-adapter@2.19.0"
Write-Host "  4. ~/.paseo/config.json was overridden from config/paseo.config.json"
Write-Host "     (agents.providers.pi-* enabled + daemon.mcp.injectIntoAgents: true)."
Write-Host "  5. Copy config/model-routing.example.json to ~/.paseo-pi-team/model-routing.local.json"
Write-Host "     and fill in REAL model IDs from: paseo provider models pi-peer --json"
Write-Host "     Cross-host controller: also copy config/cluster-routing.example.json to"
Write-Host "     ~/.paseo-pi-team/cluster-routing.local.json (endpoint values live in env)"
Write-Host "  6. Restart the Paseo daemon (kills running agents - do it when ready)."
Write-Host "  7. In pi, run /reload to load the new extension, then /team-role."
Write-Host "  8. Verify host readiness (repo-root independent):"
Write-Host "     node `"$(Join-Path $RolePackRoot 'scripts\preflight.mjs')`""
