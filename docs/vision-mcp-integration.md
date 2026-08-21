# Vision MCP integration — read images with a remote vision model

This role pack bundles a small stdio MCP server (`mcps/vision_mcp`) that reads
an image with a remote OpenAI-compatible vision model and returns a text
analysis. It lets any Pi role answer questions about screenshots, photos,
diagrams, or PNG/JPG files through the `mcp` tool proxy — without needing a
local vision model.

## What the installer does

`scripts/vision-setup.mjs` runs during `scripts/install.sh` (and
`scripts/install.ps1`) and is idempotent:

1. copies `mcps/vision_mcp/` → `~/.pi/agent/mcps/vision_mcp/` (rebuilds
   `dist/index.js` only when the committed build is missing);
2. merges only the missing `vision` server entry into `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["/Users/<you>/.pi/agent/mcps/vision_mcp/dist/index.js"],
      "env": {
        "VISION_API_BASE": "${VISION_API_BASE}",
        "VISION_API_KEY": "${VISION_API_KEY}",
        "VISION_MODEL": "${VISION_MODEL}"
      },
      "lifecycle": "lazy"
    }
  }
}
```

An existing valid entry (any path ending in `dist/index.js`, with optional
`env`/`lifecycle`/`disabled`) is left untouched. All other MCP servers in the
file are preserved.

## Environment

The server calls an OpenAI-compatible `chat/completions` endpoint directly (it
does not go through `pi`). Set these in Pi's shell environment:

```text
VISION_API_BASE                 # base URL; fallback OPENAI_API_BASE / OPENAI_BASE_URL; default https://new-api.longphamthien.us/v1
VISION_API_KEY                  # API key; fallback OPENAI_API_KEY / NEW_API_API_KEY
VISION_MODEL                    # model id; default "vision" (Mimo V2.5)
VISION_MAX_DIM                  # optional; resize to max long edge (px) before sending, default 1280
VISION_QUALITY                  # optional; re-encode quality for jpeg/webp/avif/tiff, default 80
VISION_COMPRESS_MIN_BYTES       # optional; only compress if image is larger than this, default 0 (always)
```

> Ghi chú nén ảnh: khi gọi `read_image` bằng `path`, server nén/thu nhỏ ảnh lại
> bằng `sharp` rồi gửi **bản nén** lên model (không gửi ảnh gốc), và xoá bản nén
> vừa tạo ngay sau khi gọi xong — không để lại file tạm. Bản gốc trên đĩa vẫn
> được giữ nguyên. Các biến `VISION_MAX_DIM` / `VISION_QUALITY` /
> `VISION_COMPRESS_MIN_BYTES` tuỳ chọn để điều chỉnh mức nén.

No secret belongs in this repository; keep the key in the environment or a
local env file.

## Usage

### Khi nào dùng vision — fallback-only

Vision MCP là **fallback cho model không đọc được ảnh trực tiếp**, không phải
dụng cụ mặc định. Pi quyết định gắn ảnh inline cho model dựa trên khai báo
`input` (`["text"]` hay `["text", "image"]`) của từng model trong
`~/.pi/agent/models.json` (hoặc metadata built-in). Extension
`paseo-team-policy.ts` đọc capability đó từ runtime model mỗi turn và:

1. Inject directive `MODEL_IMAGE_READING` vào system prompt: `direct` (model
   đọc được ảnh) / `vision-only` (model không đọc được ảnh) / `unknown`.
   - `direct` → đọc ảnh bằng tool `read`; `read_image` bị chặn
     (fallback-only).
   - `vision-only` → dùng `read_image` để phân tích ảnh.
   - `unknown` → thử `read` trước, rơi về `read_image` nếu model không nhận
     ảnh.

2. Chặn `read_image` qua MCP proxy khi model hiện tại đã khai báo đọc được
   ảnh (fallback-only mặc định `ON`). Mọi role không cần grant trong brief;
   gate chỉ dựa trên capability của model đang chạy.

3. **Tự động chuyển sang vision khi model không đọc được ảnh:** với model
   text-only (`MODEL_IMAGE_READING: vision-only`), nếu agent gọi `read` lên
   file ảnh raster (png/jpg/gif/webp/bmp/avif/tiff/ico) thì extension **chặn
   `read` ngay** kèm lý do điều hướng sang `read_image` — thay vì để agent
   phí một turn đọc ảnh mà model sẽ bỏ đi. (`read` file text, `.svg`, và mọi
   thứ khác vẫn bình thường; capability `unknown` không chặn.)

Muốn luôn cho phép vision MCP (model vision riêng, nén ảnh sẵn, v.v.), bật:

```text
PASEO_VISION_FALLBACK_ONLY=0
```

Ngược lại, nếu model của bạn khai báo nhầm `"image"` trong `input` mà thực
tế không đọc được ảnh, hãy **bỏ `"image"` khỏi `input`** của model đó trong
`~/.pi/agent/models.json` — vision fallback sẽ tự mở lại.

### Verify trước khi dùng vision MCP

Có hai cách kiểm tra model có đọc được ảnh hay không TRƯỚC khi quyết định
dùng vision:

1. **Tĩnh (nhanh, miễn phí)** — nhìn directive `MODEL_IMAGE_READING` mà
extension inject mỗi turn, hoặc xem khai báo `input` của model trong
`~/.pi/agent/models.json`. `input` có `"image"` → model đọc được ảnh trực
tiếp, không cần vision.

2. **Động (end-to-end, chắc chắn)** — chạy probe gửi một ảnh PNG 1×1 tới
endpoint chat/completions của model và xem model có trả lời được không:

```bash
# model đang định dùng (vd planner):
node scripts/check-vision-support.mjs --model <pi-provider>/<model-id> --json
# hoặc chính vision model qua biến môi trường vision-mcp:
node scripts/check-vision-support.mjs --model vision --json
```

Kết quả: `VERIFIED` (model đọc được ảnh → không cần vision), `REJECTED`
(model/API từ chối payload ảnh → đây chính là lúc dùng vision MCP),
`UNCONFIGURED` (thiếu key), `ERROR` (mạng/auth/timeout).

### Calling read_image

Cả ba role (supervisor/lead/peer) có thể gọi `read_image` qua `mcp` khi model
hiện tại không đọc được ảnh trực tiếp (hoặc khi `PASEO_VISION_FALLBACK_ONLY=0`):

```text
mcp({ tool: "read_image", args: { path: "<absolute path to image>", prompt: "<question / what to analyze>" } })
```

Nếu tool báo tên có prefix (`vision_read_image`, `vision:read_image`, ...),
dùng đúng tên đó. Không dùng bash để đọc file ảnh thay cho vision MCP.

## Troubleshooting

### `vision` MCP server missing

Verify the entry in `~/.pi/agent/mcp.json`, confirm the copied server exists at
`~/.pi/agent/mcps/vision_mcp/dist/index.js`, and run `/reload` in Pi.

### Vision environment not configured

`node scripts/preflight.mjs --json` warns `vision-env` when the key is missing.
Set `VISION_API_KEY` (plus optional `VISION_API_BASE`/`VISION_MODEL`) in Pi's
shell environment and restart Pi.

### `read_image` is blocked even though the vision MCP is installed

That is expected when the current model declares image input
(`MODEL_IMAGE_READING: direct`): vision is fallback-only by default
(`PASEO_VISION_FALLBACK_ONLY`). The agent should read the image with the
`read` tool instead. To force the vision MCP back on, set
`PASEO_VISION_FALLBACK_ONLY=0`, or remove `"image"` from the model's `input`
in `~/.pi/agent/models.json` if it genuinely cannot read images.

### Image read fails or returns an auth error

Check `VISION_API_KEY` against the endpoint at `VISION_API_BASE`. The default
endpoint requires a `NEW_API_KEY`-style credential; the server falls back to
`OPENAI_API_KEY` when `VISION_API_KEY` is unset.
