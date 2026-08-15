// Paseo daemon config integrity checks: install.sh must override
// ~/.paseo/config.json from the canonical config/paseo.config.json, and the
// canonical file must stay valid and enable the Pi role pack providers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const installSh = read("scripts/install.sh");
const installPs1 = read("scripts/install.ps1");
const configText = read("config/paseo.config.json");

// install.sh: copies the canonical config into ~/.paseo/config.json.
assert.ok(installSh.includes("config/paseo.config.json"), "install.sh references the canonical config file");
assert.ok(installSh.includes('"$HOME/.paseo/config.json"'), "install.sh overrides ~/.paseo/config.json");
assert.ok(
	installSh.includes('cp -f "$ROLE_PACK_ROOT/config/paseo.config.json" "$HOME/.paseo/config.json"'),
	"install.sh copies config/paseo.config.json -> ~/.paseo/config.json",
);

// install.ps1 mirrors the same override.
assert.ok(installPs1.includes("config/paseo.config.json"), "install.ps1 references the canonical config file");
assert.ok(installPs1.includes('"$env:USERPROFILE\\.paseo\\config.json"'), "install.ps1 overrides ~/.paseo/config.json");
assert.ok(
	installPs1.includes('Copy-Item (Join-Path $RolePackRoot "config\\paseo.config.json") "$env:USERPROFILE\\.paseo\\config.json" -Force'),
	"install.ps1 copies config/paseo.config.json -> ~/.paseo/config.json",
);

// The canonical config is valid JSON and an object.
const config = JSON.parse(configText);
assert.equal(typeof config, "object");
assert.ok(!Array.isArray(config));

// MCP injection covers the three Pi roles.
assert.deepEqual(config.daemon.mcp.injectIntoProviders, [
	"pi-supervisor",
	"pi-lead",
	"pi-peer",
]);
assert.equal(config.daemon.mcp.injectIntoAgents, true);

// Pi providers exist, extend pi, and carry role env; base pi is enabled.
assert.equal(config.agents.providers.pi.enabled, true);
for (const role of ["pi-supervisor", "pi-lead", "pi-peer"]) {
	const provider = config.agents.providers[role];
	assert.ok(provider, `${role} provider exists`);
	assert.equal(provider.extends, "pi", `${role} extends pi`);
	assert.equal(provider.env.PASEO_PI_ROLE, role.replace("pi-", ""), `${role} sets PASEO_PI_ROLE`);
	assert.ok(Array.isArray(provider.models) && provider.models.length > 0, `${role} has models`);
}

// Non-Pi providers are disabled (role pack runs on Pi).
for (const provider of ["copilot", "codex", "claude", "opencode"]) {
	assert.equal(config.agents.providers[provider].enabled, false, `${provider} disabled`);
}

console.log("[paseo-team] paseo config integrity tests passed");
