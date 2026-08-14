#!/usr/bin/env node
// vision-setup.mjs — install the vision MCP server for the Paseo + Pi role pack.
//
// vision-mcp is a small stdio MCP server (src + committed dist) that reads an
// image with a remote OpenAI-compatible vision model. Pi's MCP adapter reads
// the user-global config at ~/.pi/agent/mcp.json, so this script:
//   - copies mcps/vision_mcp from the role pack into <agentDir>/mcps/vision_mcp;
//   - rebuilds dist/index.js only when the committed build is missing;
//   - adds only the missing `vision` server entry and never rewrites an
//     existing valid server definition.
//
// Self-contained on purpose: it must NOT import browser-setup.mjs (both
// scripts are launched with --install, which would trigger the other's
// install path via browser-setup's top-level argv check).

import { spawnSync } from "node:child_process";
import {
	cpSync,
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
import { fileURLToPath } from "node:url";

export const VISION_MCP_SERVER = "vision";
// Path of the vision server inside the role pack (relative to repo root).
export const VISION_SRC_REL = "mcps/vision_mcp";
// Installer-owned directory name under <agentDir>/mcps/.
export const VISION_INSTALL_DIR_NAME = "vision_mcp";

const CONFIG_LOCK_RETRIES = 50;
const CONFIG_LOCK_WAIT_MS = 100;
const CONFIG_LOCK_STALE_MS = 5 * 60 * 1000;

/** Directory holding the vision server copy the installer manages. */
export function visionInstallDir(piHome) {
	return join(defaultAgentDir(piHome), "mcps", VISION_INSTALL_DIR_NAME);
}

/** MCP server entry the installer writes for a freshly installed server. */
export function visionMcpConfig(serverDir) {
	return {
		command: "node",
		args: [join(serverDir, "dist", "index.js")],
		env: {
			VISION_API_BASE: "${VISION_API_BASE}",
			VISION_API_KEY: "${VISION_API_KEY}",
			VISION_MODEL: "${VISION_MODEL}",
		},
		lifecycle: "lazy",
	};
}

/**
 * True when `server` is a usable vision MCP definition. The entry may point
 * anywhere (the installer copy or a user-managed checkout) — only the shape
 * matters, so a valid user-modified config is never overwritten.
 */
export function isValidVisionMcpServer(server) {
	if (
		!server ||
		typeof server !== "object" ||
		Array.isArray(server) ||
		typeof server.command !== "string" ||
		server.command.trim() !== "node" ||
		!Array.isArray(server.args) ||
		server.args.length !== 1 ||
		typeof server.args[0] !== "string" ||
		!server.args[0].replaceAll("\\", "/").endsWith("dist/index.js")
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

/** Add the vision server only when the user has not configured it yet. */
export function mergeVisionMcpConfig(config, serverDir) {
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
	const existing = servers[VISION_MCP_SERVER];
	if (existing !== undefined && isValidVisionMcpServer(existing)) return source;
	return {
		...source,
		mcpServers: {
			...servers,
			[VISION_MCP_SERVER]: visionMcpConfig(serverDir),
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
	node: process.execPath,
	npm: process.platform === "win32" ? "npm.cmd" : "npm",
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

/** Exclude build/git internals from the copied server directory. */
function copyFilter(src) {
	return !src.includes("node_modules") && !src.endsWith(".git");
}

export function installVisionMcp({ piHome, repoRoot, configPath } = {}) {
	const resolvedRepoRoot =
		repoRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
	const resolvedConfig = configPath ?? defaultMcpConfigPath(piHome);
	const resolvedInstall = visionInstallDir(piHome);
	const actions = [];

	// 1. Copy the server source + committed build into the installer-owned dir.
	const srcDir = join(resolvedRepoRoot, VISION_SRC_REL);
	if (!existsSync(join(srcDir, "package.json"))) {
		throw new Error(`vision MCP source missing: ${srcDir}`);
	}
	rmSync(resolvedInstall, { recursive: true, force: true });
	mkdirSync(dirname(resolvedInstall), { recursive: true });
	cpSync(srcDir, resolvedInstall, {
		recursive: true,
		force: true,
		filter: copyFilter,
	});
	actions.push(`installed vision MCP server -> ${resolvedInstall}`);

	// 2. Ensure the compiled entry exists; rebuild only when it is missing.
	const entry = join(resolvedInstall, "dist", "index.js");
	if (!existsSync(entry)) {
		for (const args of [
			["install", "--no-audit", "--no-fund"],
			["run", "build"],
		]) {
			const result = run("npm", args, { cwd: resolvedInstall, timeout: 300000 });
			if (!result.ok) {
				throw new Error(
					`vision MCP build failed (npm ${args[0]}): ${result.stderr || result.error || result.stdout}`,
				);
			}
		}
		actions.push("rebuilt vision MCP dist (npm install && npm run build)");
	}
	if (!existsSync(entry)) {
		throw new Error(`vision MCP entry missing after setup: ${entry}`);
	}

	// 3. Merge the MCP entry only when no candidate already has a valid one.
	const existingConfig = mcpConfigCandidates(piHome).some((path) => {
		try {
			return isValidVisionMcpServer(
				readJson(path).mcpServers?.[VISION_MCP_SERVER],
			);
		} catch {
			return false;
		}
	});
	if (existingConfig) {
		actions.push(`MCP server ${VISION_MCP_SERVER} already configured`);
	} else {
		mkdirSync(dirname(resolvedConfig), { recursive: true });
		withConfigLock(resolvedConfig, () => {
			const before = readJson(resolvedConfig);
			const after = mergeVisionMcpConfig(before, resolvedInstall);
			if (after !== before) {
				writeJsonAtomic(resolvedConfig, after);
				actions.push(`added MCP server ${VISION_MCP_SERVER}`);
			}
		});
	}

	return { actions, installDir: resolvedInstall, configPath: resolvedConfig };
}

if (process.argv.includes("--install")) {
	const valueAfter = (flag) => {
		const index = process.argv.indexOf(flag);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};
	try {
		const result = installVisionMcp({
			piHome: valueAfter("--pi-home"),
			repoRoot: valueAfter("--repo-root"),
			configPath: valueAfter("--config"),
		});
		console.log(`[paseo-team] ${result.actions.join("; ")}`);
	} catch (error) {
		console.error(
			`[paseo-team] vision MCP setup failed: ${String(error?.message ?? error)}`,
		);
		process.exitCode = 1;
	}
}
