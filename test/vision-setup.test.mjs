import assert from "node:assert/strict";
import { join } from "node:path";
import {
	VISION_INSTALL_DIR_NAME,
	VISION_MCP_SERVER,
	isValidVisionMcpServer,
	mcpConfigCandidates,
	mergeVisionMcpConfig,
	visionInstallDir,
	visionMcpConfig,
} from "../scripts/vision-setup.mjs";

const serverDir = "/opt/pi/agent/mcps/vision_mcp";

// Existing valid vision config must survive merge byte-for-byte in meaning.
{
	const existing = {
		settings: { toolPrefix: "server" },
		mcpServers: {
			github: { command: "gh-mcp", args: ["serve"] },
			[VISION_MCP_SERVER]: {
				command: "node",
				args: ["/home/user/vision/dist/index.js"],
				env: { VISION_API_KEY: "real-key" },
				lifecycle: "lazy",
				directTools: true,
			},
		},
	};
	const merged = mergeVisionMcpConfig(existing, serverDir);
	assert.strictEqual(
		merged,
		existing,
		"valid existing vision config is never overwritten (same reference)",
	);
}

// Invalid existing entry (non-object) is replaced; other servers survive.
{
	const merged = mergeVisionMcpConfig(
		{
			mcpServers: { [VISION_MCP_SERVER]: "enabled", github: { command: "gh" } },
		},
		serverDir,
	);
	assert.deepEqual(merged.mcpServers[VISION_MCP_SERVER], visionMcpConfig(serverDir));
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
}

// Missing entry is added; other servers survive.
{
	const merged = mergeVisionMcpConfig(
		{ mcpServers: { github: { command: "gh" } } },
		serverDir,
	);
	assert.deepEqual(merged.mcpServers.github, { command: "gh" });
	assert.deepEqual(merged.mcpServers[VISION_MCP_SERVER], visionMcpConfig(serverDir));
}

// Generated config shape: node entry, single dist/index.js arg, env placeholders, lazy.
{
	const cfg = visionMcpConfig(serverDir);
	assert.equal(cfg.command, "node");
	assert.deepEqual(cfg.args, [join(serverDir, "dist", "index.js")]);
	assert.deepEqual(cfg.env, {
		VISION_API_BASE: "${VISION_API_BASE}",
		VISION_API_KEY: "${VISION_API_KEY}",
		VISION_MODEL: "${VISION_MODEL}",
	});
	assert.equal(cfg.lifecycle, "lazy");
}

// Validator: generated config is valid; malformed shapes are rejected.
assert.equal(isValidVisionMcpServer(visionMcpConfig(serverDir)), true);
assert.equal(
	isValidVisionMcpServer({
		command: "node",
		args: [join(serverDir, "dist", "index.js")],
		env: { VISION_API_KEY: "x" },
		lifecycle: "lazy",
		disabled: false,
	}),
	true,
	"env/lifecycle/disabled optional fields are accepted",
);
assert.equal(isValidVisionMcpServer("enabled"), false);
assert.equal(isValidVisionMcpServer(null), false);
assert.equal(isValidVisionMcpServer({ command: "python", args: [join(serverDir, "dist", "index.js")] }), false);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: ["index.js", "extra"] }),
	false,
	"more than one arg is invalid",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: ["dist/index.js"] }),
	true,
	"relative dist/index.js path is accepted",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: ["dist/server.js"] }),
	false,
	"entry must end in dist/index.js",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: [join(serverDir, "dist", "index.js")], env: "x" }),
	false,
	"non-object env is invalid",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: [join(serverDir, "dist", "index.js")], env: [] }),
	false,
	"array env is invalid",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: [join(serverDir, "dist", "index.js")], lifecycle: 123 }),
	false,
	"non-string lifecycle is invalid",
);
assert.equal(
	isValidVisionMcpServer({ command: "node", args: [join(serverDir, "dist", "index.js")], disabled: "yes" }),
	false,
	"non-boolean disabled is invalid",
);

// Installer-owned directory is <piHome>/agent/mcps/vision_mcp.
assert.equal(
	visionInstallDir("/home/pi"),
	join("/home/pi", "agent", "mcps", VISION_INSTALL_DIR_NAME),
);
assert.ok(
	mcpConfigCandidates("/home/pi").some((path) => /agent[\\/]mcp\.json$/.test(path)),
);

console.log("[paseo-team] vision setup tests passed");
