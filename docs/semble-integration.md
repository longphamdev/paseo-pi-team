# Semble integration — code search MCP server

This role pack integrates [Semble](https://github.com/MinishLab/semble) as an
intent-based code search tool exposed through Pi's MCP config. Semble indexes a
repository and lets an agent find code by describing what it does or naming a
symbol/identifier, instead of grepping for literal strings.

## What the installer does

`scripts/semble-setup.mjs` runs during `scripts/install.sh` (and
`scripts/install.ps1`) and is idempotent — re-running it never duplicates or
overwrites an existing valid config:

1. `uv tool install semble` — installs the Semble CLI (requires
   [uv](https://docs.astral.sh/uv/));
2. `pi install npm:pi-mcp-extension` — Pi MCP extension prerequisite so Semble
   can connect through Pi;
3. merges only the missing `semble` server entry into `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "semble": {
      "command": "uvx",
      "args": ["--from", "semble[mcp]", "semble"]
    }
  }
}
```

An existing valid entry (including one with extra args such as
`--content all`) is left untouched. All other MCP servers in the file are
preserved.

## Usage

Agents (Pi roles) use the `semble` CLI directly. The prompt files
(`prompts/peer.md`, `prompts/lead.md`, `prompts/supervisor.md`) each end with a
`## Code Search` section documenting the commands:

```bash
semble search "authentication flow" ./my-project --max-snippet-lines 10
semble search "save_pretrained" ./my-project
semble search "save model to disk" ./my-project --top-k 10
```

Search docs/config too by passing `--content`:

```bash
semble search "deployment guide" ./my-project --content docs
semble search "database host port" ./my-project --content config
semble search "authentication" ./my-project --content all
```

Discover related code from a known location:

```bash
semble find-related src/auth.py 42 ./my-project
```

`path` defaults to the current directory when omitted; git URLs are accepted.
If `semble` is not on `$PATH`, use `uvx --from "semble[mcp]" semble` in its
place.

The index is built on first run (and cached for subsequent runs) and
invalidated automatically when files change.

## Troubleshooting

### `semble` command not found

`uv tool install semble` installs to `~/.local/bin`; make sure that directory is
on `PATH`. If it is not, either add it or invoke through `uvx --from
"semble[mcp]" semble`.

### MCP server not showing in Pi

Verify the entry in `~/.pi/agent/mcp.json` (see above), confirm
`pi install npm:pi-mcp-extension` completed, and run `/reload` in Pi.

### Search results stale

Semble invalidates its index when files change. If results look stale, re-run
the search; the index rebuild is automatic.
