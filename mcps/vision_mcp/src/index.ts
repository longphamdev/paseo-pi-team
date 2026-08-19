/**
 * vision-mcp — MCP server that reads/analyzes images with a remote
 * OpenAI-compatible vision model (default: "vision" = Mimo V2.5).
 *
 * Talks to the same kind of upstream that pi itself uses (new-api /
 * OpenAI-compatible chat/completions), but calls it directly instead of
 * going through pi.
 *
 * Env (có thể set trực tiếp trong shell hoặc qua block `env` trong .mcp.json,
 * empty string được coi như chưa set để rơi về fallback/default):
 *   VISION_API_BASE  - base URL, fallback OPENAI_API_BASE / OPENAI_BASE_URL,
 *                      default https://new-api.longphamthien.us/v1
 *   VISION_API_KEY   - API key, fallback OPENAI_API_KEY / NEW_API_API_KEY
 *   VISION_MODEL     - model id, fallback OPENAI_MODEL, default "vision"
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdtemp, stat, rm } from "node:fs/promises";
import { extname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

/** Env helper: trả undefined cho biến chưa set HOẶC set thành chuỗi rỗng/whitespace. */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const API_BASE =
  env("VISION_API_BASE") ??
  env("OPENAI_API_BASE") ??
  env("OPENAI_BASE_URL") ??
  "https://new-api.longphamthien.us/v1";
const API_KEY =
  env("VISION_API_KEY") ?? env("OPENAI_API_KEY") ?? env("NEW_API_API_KEY") ?? "";
const MODEL = env("VISION_MODEL") ?? env("OPENAI_MODEL") ?? "vision";
// Một số model (vd Mimo V2.5) là reasoning model: viết `reasoning_content` trước khi
// ra đáp án thật ở `content`; `max_tokens` tính gộp cả phần reasoning + content, nên
// reasoning dài sẽ nuốt trọn max_tokens -> content về null. LUÔN TẮT thinking để
// tránh lỗi "empty output" bất kể model nào (hầu hết proxy bỏ qua param lạ nên an toàn).
const THINKING = { type: "disabled" };
const MAX_IMAGE_BYTES = Number(env("VISION_MAX_IMAGE_BYTES") ?? 25 * 1024 * 1024);
const TIMEOUT_MS = Number(env("VISION_TIMEOUT_MS") ?? 180_000);
// Nén ảnh trước khi gửi lên model (chỉ áp dụng khi gọi qua `path`).
const MAX_DIM = Number(env("VISION_MAX_DIM") ?? 1280); // cạnh dài tối đa sau khi nén (px)
const JPEG_QUALITY = Number(env("VISION_QUALITY") ?? 80); // quality cho jpeg/webp/avif/tiff
const COMPRESS_MIN_BYTES = Number(env("VISION_COMPRESS_MIN_BYTES") ?? 0); // chỉ nén nếu ảnh > ngưỡng này

/** Chuẩn hoá base URL -> URL chat/completions (chấp nhận base đã kết thúc bằng /chat/completions). */
function chatCompletionsUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(b) ? b : `${b}/chat/completions`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
};

function mimeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "image/png";
}

/**
 * Nén / thu nhỏ ảnh cục bộ thành một bản nén tạm thời (nhỏ hơn), rồi trả về
 * mime + base64 của bản nén cùng hàm `cleanup()` để xoá bản nén vừa tạo.
 * Không gửi ảnh gốc lên model.
 */
async function compressImage(absPath: string): Promise<{
  mime: string;
  b64: string;
  originalBytes: number;
  compressedBytes: number;
  cleanup: () => Promise<void>;
}> {
  let tmpDir: string | undefined;

  const meta = await sharp(absPath).metadata();
  const fmt: string | undefined = meta.format;
  const srcW = meta.width ?? MAX_DIM;
  const srcH = meta.height ?? MAX_DIM;

  // Thu nhỏ theo cạnh dài nhất, không phóng to ảnh vốn đã nhỏ.
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  // Chọn định dạng đầu ra (giữ nguyên nếu sharp ghi được, else rơi về jpeg).
  let outExt = fmt && ["jpeg", "png", "webp", "avif", "tiff"].includes(fmt) ? fmt : "jpeg";
  let pipeline = sharp(absPath).resize(targetW, targetH, {
    fit: "inside",
    withoutEnlargement: true,
  });
  if (outExt === "jpeg") pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
  else if (outExt === "png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (outExt === "webp") pipeline = pipeline.webp({ quality: JPEG_QUALITY });
  else if (outExt === "avif") pipeline = pipeline.avif({ quality: JPEG_QUALITY });
  else if (outExt === "tiff") pipeline = pipeline.tiff({ quality: JPEG_QUALITY });

  tmpDir = await mkdtemp(join(tmpdir(), "vision-mcp-"));
  const outPath = join(tmpDir, `img.${outExt}`);
  await pipeline.toFile(outPath);

  const buf = await readFile(outPath);
  return {
    mime: MIME_BY_EXT[`.${outExt}`] ?? "image/jpeg",
    b64: buf.toString("base64"),
    originalBytes: (await stat(absPath)).size,
    compressedBytes: buf.length,
    cleanup: async () => {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

const server = new McpServer({
  name: "vision-mcp",
  version: "1.1.0",
});

server.tool(
  "read_image",
  "Analyze an image using the remote vision model (Mimo V2.5). " +
    "Provide either a local file path or a data URL. Returns the model's description/answer as text.",
  {
    path: z.string().optional().describe("Absolute or relative path to a local image file (png, jpg, webp, gif, ...)."),
    data_url: z.string().optional().describe("Alternative to path: a data URL like data:image/png;base64,<base64>."),
    prompt: z.string().optional().describe("Question or instruction for the vision model. Defaults to a detailed image description."),
    max_tokens: z.number().optional().describe("Maximum output tokens. Defaults to 4096."),
  },
  async ({ path: filePath, data_url, prompt, max_tokens }) => {
    let tempCleanup: (() => Promise<void>) | null = null;
    let compressionNote = "";
    try {
      if (!API_KEY) {
        return {
          content: [
            {
              type: "text",
              text: "No API key configured: set VISION_API_KEY, OPENAI_API_KEY or NEW_API_API_KEY " +
                "in the environment (or in the MCP server 'env' block of .mcp.json).",
            },
          ],
          isError: true,
        };
      }

      let mime = "";
      let b64 = "";

      if (data_url) {
        const m = /^data:([^;,]+);base64,(.+)$/s.exec(data_url);
        if (!m) {
          return {
            content: [{ type: "text", text: "Invalid data_url: expected data:<mime>;base64,<payload>" }],
            isError: true,
          };
        }
        mime = m[1];
        b64 = m[2];
      } else if (filePath) {
        const abs = resolve(filePath);
        const info = await stat(abs).catch(() => null);
        if (!info) {
          return { content: [{ type: "text", text: `File not found: ${abs}` }], isError: true };
        }
        if (info.size > MAX_IMAGE_BYTES) {
          return {
            content: [
              {
                type: "text",
                text: `Image too large (${info.size} bytes, max ${MAX_IMAGE_BYTES}). Use a smaller image.`,
              },
            ],
            isError: true,
          };
        }
        // Nén ảnh lại nhỏ hơn, gửi bản nén lên model, rồi xoá bản nén vừa tạo
        // (thay vì gửi ảnh gốc). Bỏ qua nếu ảnh đã nhỏ hơn ngưỡng COMPRESS_MIN_BYTES.
        if (info.size > COMPRESS_MIN_BYTES) {
          const c = await compressImage(abs);
          mime = c.mime;
          b64 = c.b64;
          tempCleanup = c.cleanup;
          compressionNote = `\n(image compressed ${c.originalBytes} -> ${c.compressedBytes} bytes before sending)`;
        } else {
          const buf = await readFile(abs);
          mime = mimeFor(abs);
          b64 = buf.toString("base64");
        }
      } else {
        return {
          content: [{ type: "text", text: "Provide either a 'path' or a 'data_url'." }],
          isError: true,
        };
      }

      const userText =
        prompt && prompt.trim().length > 0
          ? prompt
          : "Describe this image in detail, including any text, objects, colors, and layout.";

      const body = {
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            ],
          },
        ],
        max_tokens: max_tokens ?? 4096,
        thinking: THINKING,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let res: Response;
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
      } finally {
        clearTimeout(timer);
      }

      const raw = await res.text();
      if (!res.ok) {
        return {
          content: [
            { type: "text", text: `Vision API error (${res.status}): ${raw.slice(0, 2000)}` },
          ],
          isError: true,
        };
      }

      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        return { content: [{ type: "text", text: `Invalid JSON from vision API: ${raw.slice(0, 2000)}` }], isError: true };
      }

      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        return { content: [{ type: "text", text: "Vision model returned empty output." }], isError: true };
      }

      return { content: [{ type: "text", text: text + compressionNote }] };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: `read_image failed: ${err?.message ?? String(err)}` },
        ],
        isError: true,
      };
    } finally {
      // Xoá bản nén vừa tạo (nếu có) dù gọi model thành công hay thất bại.
      if (tempCleanup) {
        await tempCleanup().catch(() => {});
      }
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`vision-mcp fatal: ${err?.message ?? err}`);
  process.exit(1);
});
