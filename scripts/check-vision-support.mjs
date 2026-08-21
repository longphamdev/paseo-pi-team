#!/usr/bin/env node
// check-vision-support.mjs — verify, BEFORE using the vision MCP, whether a
// model actually accepts image content end-to-end.
//
// Sends a tiny 1x1 PNG to an OpenAI-compatible chat/completions endpoint and
// reports whether the model accepts an `image_url` input block:
//   • VERIFIED    → the model/endpoint answered a normal completion with an
//                   embedded image → it can read images, vision MCP is a
//                   fallback you usually do NOT need.
//   • REJECTED    → the API refused the image payload (typical for text-only
//                   models) → THIS is the case where the vision MCP is the
//                   right tool.
//   • UNCONFIGURED→ no API key resolved; set the vision env / flags.
//   • ERROR       → network/auth/timeout; nothing proven, retry.
//
// Usage:
//   node scripts/check-vision-support.mjs [--json] [--model <id>]
//         [--base <chat-completions base url>] [--key <api key>] [--timeout <ms>]
// Env fallbacks (same as vision MCP):
//   VISION_API_BASE / VISION_API_KEY / VISION_MODEL,
//   then OPENAI_API_BASE / OPENAI_API_KEY / OPENAI_MODEL / NEW_API_API_KEY.
// Default endpoint https://new-api.longphamthien.us/v1, default model "vision".
//
// Exit code: 0 = VERIFIED, 1 = REJECTED/ERROR, 2 = UNCONFIGURED.

import { deflateSync } from "node:zlib";

const opt = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const wantJson = process.argv.includes("--json");

function env(name) {
	const v = process.env[name];
	return v && v.trim().length > 0 ? v.trim() : undefined;
}

const API_BASE =
	opt("--base", env("VISION_API_BASE") ?? env("OPENAI_API_BASE") ?? env("OPENAI_BASE_URL")) ??
	"https://new-api.longphamthien.us/v1";
const API_KEY =
	opt("--key", env("VISION_API_KEY") ?? env("OPENAI_API_KEY") ?? env("NEW_API_API_KEY")) ?? "";
const MODEL =
	opt("--model", env("VISION_MODEL") ?? env("OPENAI_MODEL")) ?? "vision";
// Accept both the bare model id ("planner") and the routing-style
// "provider/model" ("new-api/planner") — strip the provider prefix so the id
// sent to chat/completions is the raw model id.
const MODEL_ID = MODEL.includes("/")
	? MODEL.slice(MODEL.indexOf("/") + 1)
	: MODEL;
const TIMEOUT_MS = Number(opt("--timeout", env("VISION_TIMEOUT_MS") ?? 180_000));

function chatCompletionsUrl(base) {
	const b = base.replace(/\/+$/, "");
	return /\/chat\/completions$/i.test(b) ? b : `${b}/chat/completions`;
}

// --- tiny valid 1x1 RGBA PNG -------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

/** A valid 1x1 transparent PNG so the endpoint/model decodes a real image. */
function tinyPngB64() {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0); // width
	ihdr.writeUInt32BE(1, 4); // height
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	const idat = deflateSync(Buffer.from([0, 255, 0, 0, 255])); // filter + 1 RGBA px
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", idat),
		pngChunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

function done(status, detail, exitCode) {
	if (wantJson) {
		console.log(
			JSON.stringify(
				{ status, statusText: status, model: MODEL, detail },
				null,
				2,
			),
		);
	} else {
		console.log(
			`[check-vision-support] model=${MODEL} status=${status} — ${detail}`,
		);
	}
	process.exit(exitCode);
}

if (!API_KEY) {
	done(
		"UNCONFIGURED",
		"no API key — set VISION_API_KEY (or OPENAI_API_KEY/NEW_API_API_KEY) or pass --key <key>",
		2,
	);
}

const body = {
	model: MODEL_ID,
	messages: [
		{
			role: "user",
			content: [
				{ type: "text", text: "Answer this: what color is the image? Reply in one word." },
				{
					type: "image_url",
					image_url: { url: `data:image/png;base64,${tinyPngB64()}` },
				},
			],
		},
	],
	// Reasoning models write `reasoning_content` first and share a single
	// max_tokens budget, so keep the cap comfortably above the reasoning cost.
	max_tokens: 512,
};

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

const result = await (async () => {
	let res;
	try {
		res = await fetch(chatCompletionsUrl(API_BASE), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${API_KEY}`,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (err) {
		return { ok: false, raw: `request failed: ${String(err?.message ?? err)}` };
	} finally {
		clearTimeout(timer);
	}
	const raw = await res.text().catch(() => "");
	if (!res.ok) {
		return { ok: false, raw: `HTTP ${res.status}: ${raw.slice(0, 500)}` };
	}
	let json;
	try {
		json = JSON.parse(raw);
	} catch {
		return { ok: false, raw: `invalid JSON from API: ${raw.slice(0, 300)}` };
	}
	const text = json?.choices?.[0]?.message?.content;
	if (typeof text === "string" && text.trim().length > 0) {
		return { ok: true, raw: text.trim().slice(0, 120) };
	}
	// 2xx but no text: some proxies mask rejection with an empty turn. Treat
	// as NOT verified — the image path did not produce a real answer.
	return { ok: false, raw: "HTTP 2xx but empty content (no usable image answer)" };
})();

if (!result.ok) {
	const detail = result.raw;
	// A clear refusal or 4xx on the image payload is precisely the text-only
	// model case → this model needs the vision MCP fallback.
	done(
		"REJECTED",
		`model/API did not accept the image input: ${detail} — use the vision MCP (read_image) for images`,
		1,
	);
}
done("VERIFIED", `model accepted and answered an embedded image ("${result.raw}") — it reads images directly; vision MCP is only needed as a deliberate fallback`, 0);