import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	PI_MCP_EXTENSION_PACKAGE,
	SEMBLE_MCP_SERVER,
	isValidSembleMcpServer,
	mcpConfigCandidates,
	mergeSembleMcpConfig,
	sembleMcpConfig,
} from "../scripts/semble-setup.mjs";

// Generated config shape: uvx --from semble[mcp] semble.
{
	const cfg = sembleMcpConfig();
	assert.equal(cfg.command, "uvx");
	assert.deepEqual(cfg.args, ["--from", "semble[mcp]", "semble"]);
}

// Existing valid semble config must survive merge byte-for-byte in meaning.
{
	const existing = {
		settings: { toolPrefix: "server" },
		mcpServers: {
			github: { command: "gh-mcp", args: ["serve"] },
			[SEMBLE_MCP_SERVER]: {
				command: "uvx",
				args: ["--from", "semble[mcp]", "semble", "--content", "all"],
				lifecycle: "lazy",
			},
		},
	};
	const merged = mergeSembleMcpConfig(existing);
	assert.strictEqual(
		merged,
		existing,
		"valid existing semble config is never overwritten (same reference)",
	);
}

// Invalid existing entry (non-object) is replaced; other servers survive.
{
	const merged = mergeSembleMcpConfig({
		mcpServers: { [SEMBLE_MCP_SERVER]: "enabled", github: { command: "gh" } },
	});
	assert.deepEqual(merged.mcpServers[SEMBLE_MCP_SERVER], sembleMcpConfig());
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
}

// Missing entry is added; other servers survive.
{
	const merged = mergeSembleMcpConfig({ mcpServers: { github: { command: "gh" } } });
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
	assert.deepEqual(merged.mcpServers[SEMBLE_MCP_SERVER], sembleMcpConfig());
}

// Validator: generated config is valid; malformed shapes are rejected.
assert.equal(isValidSembleMcpServer(sembleMcpConfig()), true);
assert.equal(
	isValidSembleMcpServer({
		command: "uvx",
		args: ["--from", "semble[mcp]", "semble"],
		env: { FOO: "bar" },
		lifecycle: "lazy",
		disabled: false,
	}),
	true,
	"env/lifecycle/disabled optional fields are accepted",
);
assert.equal(
	isValidSembleMcpServer({
		command: "uvx",
		args: ["--from", "semble[mcp]", "semble", "--content", "docs"],
	}),
	true,
	"extra trailing args (--content) are accepted",
);
assert.equal(isValidSembleMcpServer("enabled"), false);
assert.equal(isValidSembleMcpServer(null), false);
assert.equal(
	isValidSembleMcpServer({ command: "uvx", args: ["--from", "semble[mcp]"] }),
	false,
	"missing the semble program is invalid",
);
assert.equal(
	isValidSembleMcpServer({ command: "python", args: ["--from", "semble[mcp]", "semble"] }),
	false,
	"wrong command is invalid",
);
assert.equal(
	isValidSembleMcpServer({ command: "uvx", args: ["--from", "other", "semble"] }),
	false,
	"wrong --from package is invalid",
);
assert.equal(
	isValidSembleMcpServer({ command: "uvx", args: ["--from", "semble[mcp]", "semble"], env: "x" }),
	false,
	"non-object env is invalid",
);
assert.equal(
	isValidSembleMcpServer({ command: "uvx", args: ["--from", "semble[mcp]", "semble"], lifecycle: 123 }),
	false,
	"non-string lifecycle is invalid",
);
assert.equal(
	isValidSembleMcpServer({ command: "uvx", args: ["--from", "semble[mcp]", "semble"], disabled: "yes" }),
	false,
	"non-boolean disabled is invalid",
);

// Candidate paths include the pi agent mcp.json.
assert.ok(
	mcpConfigCandidates("/home/pi").some((path) => /agent[\\/]mcp\.json$/.test(path)),
);

// Integrity: installers wire the semble setup script + package constant.
const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const installSh = read("scripts/install.sh");
const installPs1 = read("scripts/install.ps1");
const peerPrompt = read("prompts/peer.md");
const leadPrompt = read("prompts/lead.md");
const supervisorPrompt = read("prompts/supervisor.md");
const sembleSetup = read("scripts/semble-setup.mjs");

assert.ok(installSh.includes("semble-setup.mjs"), "install.sh calls semble-setup.mjs");
assert.ok(installSh.includes("uv tool install semble"), "install.sh documents uv tool install semble");
assert.ok(installSh.includes(PI_MCP_EXTENSION_PACKAGE), "install.sh documents the Pi MCP extension package");
assert.ok(installPs1.includes("semble-setup.mjs"), "install.ps1 calls semble-setup.mjs");
assert.ok(installPs1.includes("uv tool install semble"), "install.ps1 documents uv tool install semble");
assert.ok(installPs1.includes(PI_MCP_EXTENSION_PACKAGE), "install.ps1 documents the Pi MCP extension package");
assert.ok(sembleSetup.includes('"uvx"'), "semble-setup.mjs uses uvx");
assert.ok(sembleSetup.includes('"semble[mcp]"'), "semble-setup.mjs pins semble[mcp]");

// Prompts: all three roles document the Code Search section.
for (const [name, prompt] of [
	["peer.md", peerPrompt],
	["lead.md", leadPrompt],
	["supervisor.md", supervisorPrompt],
]) {
	assert.ok(prompt.includes("## Code Search"), `${name} has the Code Search section`);
	assert.ok(prompt.includes("semble search"), `${name} mentions semble search`);
	assert.ok(prompt.includes("semble find-related"), `${name} mentions find-related`);
	assert.ok(
		prompt.includes('uvx --from "semble[mcp]" semble'),
		`${name} documents the uvx fallback`,
	);
}

console.log("[paseo-team] semble setup tests passed");
