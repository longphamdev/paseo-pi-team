// Static/reference integrity checks for the Vision MCP integration.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const policy = read("extensions/paseo-team-policy.ts");
const peerPrompt = read("prompts/peer.md");
const leadPrompt = read("prompts/lead.md");
const supervisorPrompt = read("prompts/supervisor.md");
const installSh = read("scripts/install.sh");
const installPs1 = read("scripts/install.ps1");
const visionSetup = read("scripts/vision-setup.mjs");
const visionPackage = read("mcps/vision_mcp/package.json");

// Policy: vision constants + target matcher + model-image capability helpers.
assert.ok(policy.includes('const VISION_MCP_SERVER = "vision"'));
assert.ok(policy.includes('const VISION_MCP_TARGETS: string[] = ["read_image"]'));
assert.ok(policy.includes("export function isVisionMcpTarget"));
assert.ok(policy.includes("(^|[_:])read_image$"));
// The agent must know its model's image capability before choosing read_image.
assert.ok(policy.includes("export function modelSupportsImages"));
assert.ok(policy.includes("export function visionFallbackOnly"));
assert.ok(policy.includes("export function visionMcpBlockReason"));
assert.ok(policy.includes("export function modelImageDirective"));
assert.ok(policy.includes("export function readImageBlockReason"));
assert.ok(policy.includes("PASEO_VISION_FALLBACK_ONLY"));
assert.ok(policy.includes("MODEL_IMAGE_READING"));

// Policy: every role gets the `mcp` tool; peer deny keeps mcp_script but
// drops the bare `mcp` name (the allowlist now carries it).
assert.ok(policy.includes('allow: [...PI_WRITE, "mcp"]'));
assert.ok(policy.includes('allow: [...PI_READ_ONLY, "mcp"]'));
assert.ok(policy.includes('deny: [...ALL_PASEO_TOOLS, "mcp_script"]'));
assert.ok(policy.includes('deny: [...ALL_PASEO_TOOLS, "mcp_script", "write", "edit"]'));
{
	const peerDenyLines = policy
		.split("\n")
		.filter((line) => line.includes("deny: [...ALL_PASEO_TOOLS"));
	assert.ok(peerDenyLines.length >= 2, "peer policy has two deny lines");
	for (const line of peerDenyLines) {
		assert.ok(
			!line.includes('"mcp"'),
			'peer deny must not contain a bare "mcp" name',
		);
	}
}

// Policy: read_image stays allowed without a brief grant, but vision is a
// FALLBACK — both peerMcpBlockReason and mcpBlockReason gate it behind the
// current model's declared image capability (visionMcpBlockReason).
assert.ok(
	policy.split("if (isVisionMcpTarget(target)) return visionMcpBlockReason(model);").length - 1 >=
		2,
	"both peerMcpBlockReason and mcpBlockReason gate vision targets behind the model capability",
);
assert.ok(policy.includes("export function peerMcpBlockReason"));
assert.ok(policy.includes("export function mcpBlockReason"));
assert.ok(policy.includes("export function mcpScriptBlockReason"));
assert.ok(policy.includes("...VISION_MCP_TARGETS"));
assert.ok(policy.includes("vision MCP (read_image)"));

// Prompts: all three roles document the vision MCP call shape.
const callForm =
	'mcp({ tool: "read_image", args: { path: "<đường dẫn tuyệt đối tới ảnh>", prompt: "<câu hỏi / điều cần phân tích>" } })';
for (const [name, prompt] of [
	["peer.md", peerPrompt],
	["lead.md", leadPrompt],
	["supervisor.md", supervisorPrompt],
]) {
	assert.ok(prompt.includes("## Vision MCP (đọc image)"), `${name} has the Vision MCP section`);
	assert.ok(prompt.includes("read_image"), `${name} mentions read_image`);
	assert.ok(prompt.includes(callForm), `${name} documents the read_image call form`);
	// Vision is fallback-only: the prompts tell the agent to follow the injected
	// MODEL_IMAGE_READING directive and use read_image only when the model cannot
	// read images directly.
	assert.ok(prompt.includes("MODEL_IMAGE_READING"), `${name} references the model-image directive`);
	assert.ok(prompt.includes("check-vision-support.mjs"), `${name} points at the verification script`);
}
assert.ok(peerPrompt.includes("Không dùng bash để đọc file ảnh thay cho vision MCP"));
assert.ok(supervisorPrompt.includes("Không dùng `bash` để đọc file ảnh thay cho vision MCP"));

// Verification script exists and probes an OpenAI-compatible endpoint.
const checkScript = read("scripts/check-vision-support.mjs");
assert.ok(checkScript.includes("image_url"));
assert.ok(checkScript.includes("chat/completions"));
assert.ok(checkScript.includes("VISION_API_KEY"));

// Installers: both call the vision setup script and mention it in output.
assert.ok(installSh.includes("vision-setup.mjs"));
assert.ok(installPs1.includes("vision-setup.mjs"));
assert.ok(installSh.includes("vision MCP"));
assert.ok(installPs1.includes("vision MCP"));

// vision-setup.mjs: server name, env passthrough, lazy lifecycle, idempotent merge.
assert.ok(visionSetup.includes('VISION_MCP_SERVER = "vision"'));
assert.ok(visionSetup.includes("VISION_API_KEY"));
assert.ok(visionSetup.includes("VISION_API_BASE"));
assert.ok(visionSetup.includes("VISION_MODEL"));
assert.ok(visionSetup.includes('lifecycle: "lazy"'));
assert.ok(visionSetup.includes("dist/index.js"));
assert.ok(visionSetup.includes("export function mergeVisionMcpConfig"));
assert.ok(visionSetup.includes("mcpConfigCandidates"));
assert.ok(visionSetup.includes("--install"));

// Vision server package: committed build is present (installer relies on it).
assert.ok(visionPackage.includes('"build": "tsc"'));
assert.ok(visionPackage.includes("@modelcontextprotocol/sdk"));
assert.ok(
	existsSync(join(root, "mcps", "vision_mcp", "dist", "index.js")),
	"committed dist/index.js exists so install does not need a rebuild",
);

console.log("vision integrity tests passed");
