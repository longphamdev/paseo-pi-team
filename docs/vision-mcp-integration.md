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
VISION_API_BASE  # base URL; fallback OPENAI_API_BASE / OPENAI_BASE_URL; default https://new-api.longphamthien.us/v1
VISION_API_KEY   # API key; fallback OPENAI_API_KEY / NEW_API_API_KEY
VISION_MODEL     # model id; default "vision" (Mimo V2.5)
```

No secret belongs in this repository; keep the key in the environment or a
local env file.

## Usage

All three roles (supervisor/lead/peer) may call `read_image` through the `mcp`
tool proxy — no brief grant is required:

```text
mcp({ tool: "read_image", args: { path: "<absolute path to image>", prompt: "<question / what to analyze>" } })
```

If the tool reports a prefixed name (`vision_read_image`, `vision:read_image`,
...), use that exact name. Do not use `bash` to read image files instead of the
vision MCP server.

## Troubleshooting

### `vision` MCP server missing

Verify the entry in `~/.pi/agent/mcp.json`, confirm the copied server exists at
`~/.pi/agent/mcps/vision_mcp/dist/index.js`, and run `/reload` in Pi.

### Vision environment not configured

`node scripts/preflight.mjs --json` warns `vision-env` when the key is missing.
Set `VISION_API_KEY` (plus optional `VISION_API_BASE`/`VISION_MODEL`) in Pi's
shell environment and restart Pi.

### Image read fails or returns an auth error

Check `VISION_API_KEY` against the endpoint at `VISION_API_BASE`. The default
endpoint requires a `NEW_API_KEY`-style credential; the server falls back to
`OPENAI_API_KEY` when `VISION_API_KEY` is unset.
