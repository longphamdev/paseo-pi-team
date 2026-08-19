# vision-mcp

MCP server đọc / phân tích ảnh bằng vision model từ xa (**`vision` = Mimo V2.5**), gọi thẳng qua OpenAI-compatible endpoint (`/v1/chat/completions`) — giống hệt upstream mà pi dùng, nhưng **không đi qua pi**.

## Cài đặt & build

```bash
npm install
npm run build   # biên dịch TypeScript -> dist/
```

## Chạy / test

```bash
npm test   # spawn server qua stdio, gọi read_image lên ảnh fixture, cần NEW_API_API_KEY trong env
```

## Cấu hình (env)

Server đọc cấu hình từ env — có thể set trực tiếp trong shell, hoặc qua block `env` trong config MCP (`.mcp.json` project / `~/.pi/agent/mcp.json` global). Giá trị rỗng được coi như chưa set → rơi về fallback/default.

| Biến | Fallback | Mặc định | Mô tả |
|---|---|---|---|
| `VISION_API_BASE` | `OPENAI_API_BASE`, `OPENAI_BASE_URL` | `https://new-api.longphamthien.us/v1` | Base URL OpenAI-compatible (provider) |
| `VISION_API_KEY` | `OPENAI_API_KEY`, `NEW_API_API_KEY` | *(bắt buộc)* | API key |
| `VISION_MODEL` | `OPENAI_MODEL` | `vision` | Model id (vd `mimo-v2.5`, `gpt-4o`, ...) |
| `VISION_MAX_IMAGE_BYTES` | — | `26214400` (25MB) | Giới hạn kích thước ảnh |
| `VISION_TIMEOUT_MS` | — | `180000` | Timeout gọi model |
| `VISION_MAX_DIM` | — | `1280` | Thu nhỏ ảnh về cạnh dài tối đa (px) trước khi gửi |
| `VISION_QUALITY` | — | `80` | Quality re-encode cho định dạng lossy (jpeg/webp/avif/tiff) |
| `VISION_COMPRESS_MIN_BYTES` | — | `0` | Chỉ nén nếu ảnh lớn hơn ngưỡng này (bytes); `0` = luôn nén |

### Cách 1 — export trong shell (đơn giản nhất)

```bash
export VISION_API_KEY=sk-...
export VISION_API_BASE=https://api.openai.com/v1   # tuỳ chọn
export VISION_MODEL=gpt-4o                          # tuỳ chọn
```

Nếu bạn đã có sẵn biến OpenAI thông thường thì khỏi cần config gì thêm:

```bash
export OPENAI_API_KEY=sk-...                        # vision-mcp tự dùng
```

### Cách 2 — config ngay trong `.mcp.json`

`.mcp.json` trong repo đã có sẵn block `env` (tham chiếu `${VAR}` từ shell). Muốn cấu hình cứng một provider/model khác, sửa trực tiếp:

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["/path/to/vision_mcp/dist/index.js"],
      "env": {
        "VISION_API_BASE": "https://api.openai.com/v1",
        "VISION_API_KEY": "${MY_OPENAI_KEY}",
        "VISION_MODEL": "gpt-4o"
      }
    }
  }
}
```

Cách viết `"${TEN_BIEN}"` khiến pi-mcp-adapter lấy giá trị từ env của chính pi (shell nơi chạy pi). Nếu biến chưa set, adapter truyền chuỗi rỗng và server tự rơi về fallback/default — nên config này luôn an toàn.

## Tool

### `read_image`

Phân tích ảnh bằng vision model.

- `path` (string, optional) — đường dẫn file ảnh cục bộ (png, jpg, webp, gif, ...)
- `data_url` (string, optional) — thay thế path: `data:image/png;base64,<base64>`
- `prompt` (string, optional) — câu hỏi / yêu cầu; mặc định mô tả chi tiết ảnh
- `max_tokens` (number, optional) — giới hạn output, mặc định 1024

Trả về text mô tả / câu trả lời của model.

### Nén ảnh trước khi gửi

Khi gọi `read_image` bằng **`path`**, server **không gửi ảnh gốc lên** model. Thay vào đó nó:
1. Mở ảnh gốc bằng `sharp`, **nén / thu nhỏ** theo `VISION_MAX_DIM` (cạnh dài tối đa, mặc định 1280px) và re-encode theo `VISION_QUALITY`;
2. Gửi **bản nén** (không phải ảnh gốc) lên vision API;
3. **Xoá bản nén vừa tạo** trong `finally` (dù gọi model thành công hay thất bại) — không để lại file tạm.

Bản gốc trên đĩa được giữ nguyên, chỉ có bản nén tạm được tạo/xoá. Nếu ảnh nhỏ hơn `VISION_COMPRESS_MIN_BYTES` (mặc định 0 = luôn nén) thì bỏ qua nén. `data_url` không bị nén (không có file để đọc/tạo).

## Dùng với pi CLI

pi-mcp-adapter đọc `.mcp.json` (project) và `~/.pi/agent/mcp.json` (global). Đã đăng ký sẵn trong repo `.mcp.json` (server `vision`). Sau khi build, trong pi dùng tool `mcp`:

```
mcp({ search: "read_image" })          # xem tool
mcp({ tool: "read_image", args: { path: "/path/to/img.png", prompt: "..." } })
```

Nếu chưa thấy tool, chạy `/reload` trong pi.

## Cấu trúc

```
src/index.ts          # MCP server (stdio) + gọi vision API
test/client.mjs       # e2e test qua MCP client
test/fixtures/        # ảnh test
dist/                 # bản build (đã commit)
```
