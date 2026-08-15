#!/usr/bin/env node
// semble-setup.mjs — install the Semble code-search MCP server for the
// Paseo + Pi role pack.
//
// Semble (https://github.com/MinishLab/semble) is an intent-based code
// search tool exposed as an MCP stdio server. Pi's MCP adapter reads the
// user-global config at ~/.pi/agent/mcp.json, so this script:
//   - installs the semble CLI via `uv tool install semble` (idempotent);
//   - installs Pi's MCP extension via `pi install npm:pi-mcp-extension`;
//   - adds only the missing `semble` server entry and never rewrites an
//     existing valid server definition.
//
// Self-contained on purpose: it must NOT import vision-setup.mjs or
// browser-setup.mjs.

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SEMBLE_MCP_SERVER = "semble";
// Pi MCP extension package required before semble can connect.
export const PI_MCP_EXTENSION_PACKAGE = "npm:pi-mcp-extension";

const CONFIG_LOCK_RETRIES = 50;
const CONFIG_LOCK_WAIT_MS = 100;
const CONFIG_LOCK_STALE_MS = 5 * 60 * 1000;

/** MCP server entry the installer writes for a freshly installed server. */
export function sembleMcpConfig() {
	return {
		command: "uvx",
		args: ["--from", "semble[mcp]", "semble"],
	};
}

/**
 * True when `server` is a usable semble MCP definition. The command must be
 * `uvx` with the pinned `--from semble[mcp] semble` invocation; optional
 * trailing args (e.g. `--content all`) are accepted so a valid
 * user-modified config is never overwritten.
 */
export function isValidSembleMcpServer(server) {
	if (
		!server ||
		typeof server !== "object" ||
		Array.isArray(server) ||
		typeof server.command !== "string" ||
		server.command.trim() !== "uvx" ||
		!Array.isArray(server.args) ||
		server.args.length < 3 ||
		server.args[0] !== "--from" ||
		server.args[1] !== "semble[mcp]" ||
		server.args[2] !== "semble" ||
		!server.args.every((arg) => typeof arg === "string")
	) {
		return false;
	}
	if (server.env !== undefined && (typeof server.env !== "object" || Array.isArray(server.env))) {
		return false;
	}
	if (server.lifecycle !== undefined && typeof server.lifecycle !== "string") {
		return false;
	}
	if (server.disabled !== undefined && typeof server.disabled !== "boolean") {
		return false;
	}
	return true;
}

/** Add the semble server only when the user has not configured it yet. */
export function mergeSembleMcpConfig(config) {
	const source =
		config && typeof config === "object" && !Array.isArray(config)
			? config
			: {};
	const servers =
		source.mcpServers &&
		typeof source.mcpServers === "object" &&
		!Array.isArray(source.mcpServers)
			? source.mcpServers
			: {};
	const existing = servers[SEMBLE_MCP_SERVER];
	if (existing !== undefined && isValidSembleMcpServer(existing)) return source;
	return {
		...source,
		mcpServers: {
			...servers,
			[SEMBLE_MCP_SERVER]: sembleMcpConfig(),
		},
	};
}

function defaultAgentDir(piHome) {
	return piHome
		? join(piHome, "agent")
		: (process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
}

export function defaultMcpConfigPath(piHome) {
	return join(defaultAgentDir(piHome), "mcp.json");
}

/** User-global MCP files considered by pi-mcp-adapter, in precedence order. */
export function mcpConfigCandidates(piHome, cwd = process.cwd()) {
	const agentDir = defaultAgentDir(piHome);
	const home = homedir();
	return [
		join(home, ".config", "mcp", "mcp.json"),
		join(home, ".agents", "mcp.json"),
		join(home, ".agents", "mcp", "mcp.json"),
		join(agentDir, "mcp.json"),
		join(cwd, ".mcp.json"),
		join(cwd, ".pi", "mcp.json"),
	];
}

const EXECUTABLES = Object.freeze({
	uv: "uv",
	pi: "pi",
});

function run(tool, args, options = {}) {
	const executable = EXECUTABLES[tool];
	if (!executable) throw new Error(`unsupported setup executable: ${tool}`);
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: options.timeout ?? 300000,
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		cwd: options.cwd,
		env: process.env,
	});
	return {
		ok: result.status === 0,
		stdout: String(result.stdout ?? ""),
		stderr: String(result.stderr ?? ""),
		status: result.status,
		error: result.error ? String(result.error.message ?? result.error) : "",
	};
}

function readJson(path) {
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8");
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`${path} contains invalid JSON: ${String(error?.message ?? error)}`,
		);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return value;
}

function waitSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withConfigLock(configPath, fn) {
	const lockPath = `${configPath}.lock`;
	let acquired = false;
	for (let attempt = 0; attempt < CONFIG_LOCK_RETRIES; attempt++) {
		try {
			mkdirSync(lockPath);
			writeFileSync(join(lockPath, "owner"), `${process.pid}\n`, "utf8");
			acquired = true;
			break;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			waitSync(CONFIG_LOCK_WAIT_MS);
			try {
				const lockStat = statSync(lockPath);
				if (Date.now() - lockStat.mtimeMs > CONFIG_LOCK_STALE_MS) {
					rmSync(lockPath, { recursive: true, force: true });
				}
			} catch {
				// It was removed by the owner; retry acquisition.
			}
		}
	}
	if (!acquired) {
		throw new Error(`timed out waiting for MCP config lock: ${lockPath}`);
	}
	try {
		return fn();
	} finally {
		rmSync(lockPath, { recursive: true, force: true });
	}
}

function writeJsonAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

export function installSemble({ piHome, configPath } = {}) {
	const resolvedConfig = configPath ?? defaultMcpConfigPath(piHome);
	const actions = [];

	// 1. Install the semble CLI via uv (idempotent; uv reuses the installed tool).
	const cli = run("uv", ["tool", "install", "semble"], { timeout: 300000 });
	if (!cli.ok) {
		throw new Error(
			`Could not install semble CLI: ${cli.stderr || cli.error || cli.stdout}`,
		);
	}
	actions.push("installed semble CLI (uv tool install semble)");

	// 2. Install Pi's MCP extension (required before semble can connect).
	const extension = run("pi", ["install", PI_MCP_EXTENSION_PACKAGE], {
		timeout: 300000,
	});
	if (!extension.ok) {
		throw new Error(
			`Could not install ${PI_MCP_EXTENSION_PACKAGE}: ${extension.stderr || extension.error || extension.stdout}`,
		);
	}
	actions.push(`installed Pi MCP extension (pi install ${PI_MCP_EXTENSION_PACKAGE})`);

	// 3. Merge the MCP entry only when no candidate already has a valid one.
	const existingConfig = mcpConfigCandidates(piHome).some((path) => {
		try {
			return isValidSembleMcpServer(
				readJson(path).mcpServers?.[SEMBLE_MCP_SERVER],
			);
		} catch {
			return false;
		}
	});
	if (existingConfig) {
		actions.push(`MCP server ${SEMBLE_MCP_SERVER} already configured`);
	} else {
		mkdirSync(dirname(resolvedConfig), { recursive: true });
		withConfigLock(resolvedConfig, () => {
			const before = readJson(resolvedConfig);
			const after = mergeSembleMcpConfig(before);
			if (after !== before) {
				writeJsonAtomic(resolvedConfig, after);
				actions.push(`added MCP server ${SEMBLE_MCP_SERVER}`);
			}
		});
	}

	return { actions, configPath: resolvedConfig };
}

if (process.argv.includes("--install")) {
	const valueAfter = (flag) => {
		const index = process.argv.indexOf(flag);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};
	try {
		const result = installSemble({
			piHome: valueAfter("--pi-home"),
			configPath: valueAfter("--config"),
		});
		console.log(`[paseo-team] ${result.actions.join("; ")}`);
	} catch (error) {
		console.error(
			`[paseo-team] semble MCP setup failed: ${String(error?.message ?? error)}`,
		);
		process.exitCode = 1;
	}
}
