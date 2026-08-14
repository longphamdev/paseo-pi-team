import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_BROWSER_MCP_SERVER,
	browserMcpConfig,
	isValidAgentBrowserMcpServer,
	mergeAgentBrowserMcpConfig,
	mcpConfigCandidates,
	skillIsInstalled,
} from "../scripts/browser-setup.mjs";

// Existing MCP servers/config must survive installation byte-for-byte in meaning.
{
	const existing = {
		settings: { toolPrefix: "server" },
		mcpServers: {
			github: { command: "gh-mcp", args: ["serve"] },
			[AGENT_BROWSER_MCP_SERVER]: {
				command: "agent-browser",
				args: ["mcp", "--tools", "core"],
				disabled: true,
			},
		},
	};
	const merged = mergeAgentBrowserMcpConfig(existing);
	assert.deepEqual(
		merged,
		existing,
		"valid existing agent-browser config is never overwritten",
	);
}

{
	const merged = mergeAgentBrowserMcpConfig({
		mcpServers: { [AGENT_BROWSER_MCP_SERVER]: "enabled", github: { command: "gh" } },
	});
	assert.deepEqual(merged.mcpServers[AGENT_BROWSER_MCP_SERVER], browserMcpConfig());
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
}

{
	const merged = mergeAgentBrowserMcpConfig({
		mcpServers: { github: { command: "gh" } },
	});
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
	assert.deepEqual(
		merged.mcpServers[AGENT_BROWSER_MCP_SERVER],
		browserMcpConfig(),
	);
}

assert.deepEqual(
	mergeAgentBrowserMcpConfig({}).mcpServers[AGENT_BROWSER_MCP_SERVER].args,
	["--cdp", "9222", "mcp"],
	"installer default attaches to CDP 9222",
);
assert.deepEqual(
	mergeAgentBrowserMcpConfig({}).mcpServers[AGENT_BROWSER_MCP_SERVER].lifecycle,
	"lazy",
);
assert.equal(isValidAgentBrowserMcpServer(browserMcpConfig()), true);
assert.equal(isValidAgentBrowserMcpServer("enabled"), false);
assert.equal(isValidAgentBrowserMcpServer({ command: "agent-browser", args: ["open"] }), false);
assert.equal(isValidAgentBrowserMcpServer({ command: "agent-browser", args: ["mcp"] }), true);
assert.equal(
	isValidAgentBrowserMcpServer({
		command: "agent-browser",
		args: ["--cdp", "9222", "mcp"],
		lifecycle: "lazy",
	}),
	true,
	"CDP-attach form with lifecycle lazy is valid",
);
assert.equal(
	isValidAgentBrowserMcpServer({
		command: "agent-browser",
		args: ["--cdp", "notaport", "mcp"],
	}),
	false,
	"non-numeric CDP port is invalid",
);
assert.equal(
	isValidAgentBrowserMcpServer({ command: "agent-browser", args: ["--cdp"] }),
	false,
	"truncated --cdp args are invalid",
);
assert.equal(
	isValidAgentBrowserMcpServer({
		command: "agent-browser",
		args: ["mcp"],
		lifecycle: 123,
	}),
	false,
	"non-string lifecycle is invalid",
);
{
	const prev = process.env.PASEO_TEAM_BROWSER_CDP_PORT;
	process.env.PASEO_TEAM_BROWSER_CDP_PORT = "9333";
	assert.deepEqual(browserMcpConfig().args, ["--cdp", "9333", "mcp"]);
	if (prev === undefined) delete process.env.PASEO_TEAM_BROWSER_CDP_PORT;
	else process.env.PASEO_TEAM_BROWSER_CDP_PORT = prev;
}
assert.ok(
	mcpConfigCandidates("C:/pi").some((path) =>
		/agent[\\/]mcp\.json$/.test(path),
	),
);
const skillRoot = mkdtempSync(join(tmpdir(), "paseo-browser-test-"));
mkdirSync(join(skillRoot, "agent-browser"), { recursive: true });
writeFileSync(join(skillRoot, "agent-browser", "SKILL.md"), "# test\n");
assert.equal(
	skillIsInstalled(join(skillRoot, "agent-browser", "SKILL.md")),
	true,
);
assert.equal(skillIsInstalled(join(skillRoot, "agent-browser")), false);
rmSync(skillRoot, { recursive: true, force: true });

console.log("[paseo-team] browser setup tests passed");
