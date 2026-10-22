# Serve lifecycle and transports

## Sub-features

- Cold `serve` answers MCP handshake in < 30 s even while the image builds; `layerfs_status` reports `preparing` → `ready` (or `failed` with `stage`/`error`).
- LayerFS tool calls during `preparing` fail fast with `RuntimePreparing` (no queueing, no delayed writes).
- Concurrent clients on one project share the saved profile and preparation lock; both reach `ready`.
- `stop --project` stops the runtime but **retains volumes**; the next `serve --project` (no `--backend` needed) restarts the same environment with data intact.
- Streamable HTTP: `serve --transport http --host 127.0.0.1 --port 0` prints `listening on <port>` on stderr; requires `Authorization: Bearer <LAYERFS_MCP_TOKEN>`.

## How to get to it (user POV)

The agent registers `layerfs-mcp serve --backend … --project …` under `mcpServers` (stdio) and starts chatting; the first tool list is available immediately, LayerFS calls work once status turns `ready`.

## Driving it with the MCP SDK

1. `helpers/drive.mjs` proves the cold-start half (handshake timing, 41 tools, `preparing`→`ready`).
2. Restart persistence, ad hoc: connect client A, run a write from [`files-and-branches.md`](files-and-branches.md), close A, run `node dist/cli.js stop --project <p>`, connect client B with args `serve --project <p>` only, wait `ready`, read the same file back — content must match.
3. HTTP, ad hoc: spawn `node dist/cli.js serve --project <p> --transport http --port 0` with `LAYERFS_MCP_TOKEN=<uuid>`, parse `listening on (\d+)` from stderr, then `client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:" + port + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }))` and call a tool. Without the header the connect must fail.

## Gotchas

- `stop` is not cleanup: volumes survive; full removal is the Cleanup section of SKILL.md.
- Never drive the user's `--project default`.
- stdout of serve is the MCP channel; all build/runtime logs are on stderr.
- HTTP binds the host; use `--port 0` or distinct ports so parallel drives don't collide.
- `serve` never imports files by itself: `--source` mounts read-only at `/source`, import happens only via `layerfs_project_init` or CLI `init`.
