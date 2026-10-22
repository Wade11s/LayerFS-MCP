# Serve lifecycle and transports

## Sub-features

- Cold `serve` answers the MCP handshake in < 30 s even while the image builds; `layerfs_status` reports `preparing` → `ready`, or `failed` with `stage`/`error`. A refused or aborted handshake lands in `failed`; it does not crash the server.
- LayerFS tool calls during `preparing` fail fast with `RuntimePreparing` (no queueing, no delayed writes).
- Concurrent clients on one project share the saved profile and the `runtime:` / `image:` locks; both reach `ready`.
- **Image decision table** (`prepareRuntime`, inside the image lock). The stage sequence is `checking-engine` → `preparing-image` → (`building-image`) → `starting-runtime` → `connecting`.
  | Profile image | Local state | Action |
  |---|---|---|
  | default (`defaultImage(backend)`) | missing | build from the packaged Dockerfile; no rebuild notice |
  | default | present, `io.layerfs-mcp.upstream` equals `UPSTREAM_COMMIT` | reuse silently |
  | default | present, label missing or a different commit | rebuild, printing one stderr line: `LayerFS-MCP: runtime image <tag> predates upstream <12 chars>; rebuilding` |
  | custom tag | present | reuse, no label check |
  | custom tag | missing | `image pull`; never built from the Dockerfile |
- `stop --project` stops the runtime but **retains volumes**; the next `serve --project` (no `--backend` needed) restarts the same environment with data intact.
- Streamable HTTP on loopback needs no token. `LAYERFS_MCP_TOKEN` is **required** for a non-loopback bind (`Non-loopback HTTP requires LAYERFS_MCP_TOKEN`); when a token is configured at all, every request must carry `Authorization: Bearer <token>`, and Origin must match Host or the request gets 403. Only POST reaches `/mcp`.

## How to get to it (user POV)

The agent registers `layerfs-mcp serve --backend … --project …` under `mcpServers` (stdio) and starts chatting. The first tool list is available immediately; LayerFS calls work once status turns `ready`. An operator watching stderr sees the rebuild notice exactly when their local default image is older than the pinned upstream.

## Driving it with the MCP SDK

1. `helpers/drive.mjs` proves the cold-start half: handshake timing, 41 tools, `preparing`→`ready`, and the shared-seed paths.
2. Restart persistence, ad hoc: connect client A, run a write from [`files-and-branches.md`](files-and-branches.md), close A, run `node dist/cli.js stop --project <p>`, connect client B with args `serve --project <p>` only, wait `ready`, read the same file back. Content must match. `stop` itself prints `{"project","backend","state":"stopped","volumesRetained":true}`.
3. HTTP, ad hoc: spawn `node dist/cli.js serve --project <p> --transport http --port 0` with `LAYERFS_MCP_TOKEN=<uuid>`, parse `LayerFS-MCP listening on (\d+)` from stderr, then connect with a `StreamableHTTPClientTransport` carrying the Bearer header. Without the header the connect must fail with 401. Repeat without `LAYERFS_MCP_TOKEN` on `127.0.0.1`: the connect must succeed (loopback needs no token).
4. Rebuild notice, ad hoc. `docker tag` will not work, and neither will `docker build --label`: neither changes the labels already baked into the `FROM` image. Build a thin child that re-labels, from a clean context directory (building with `/tmp` as context fails on unreadable files there):
   ```sh
   mkdir -p /tmp/labelctx
   printf 'FROM docker.io/library/layerfs-mcp:<version>\nLABEL io.layerfs-mcp.upstream=deadbeef\n' > /tmp/labelctx/Dockerfile
   docker build -q -t docker.io/library/layerfs-mcp:<version> /tmp/labelctx
   export LAYERFS_MCP_CONFIG_DIR=$(mktemp -d)
   node dist/cli.js setup --project rb --backend docker --image docker.io/library/layerfs-mcp:<version>
   ```
   Expect one stderr line, `LayerFS-MCP: runtime image docker.io/library/layerfs-mcp:<version> predates upstream <12 chars>; rebuilding`, then a rebuild that restores the label to `UPSTREAM_COMMIT`. Verify with `docker image inspect <ref> --format '{{index .Config.Labels "io.layerfs-mcp.upstream"}}'`. Save the original image id first (`--format '{{.Id}}'`) and drop the experiment afterwards.

## Gotchas

- `stop` is not cleanup: volumes survive; full removal is the Cleanup section of SKILL.md.
- Never drive the user's `--project default`.
- stdout of serve is the MCP channel; all build/runtime logs, including the rebuild notice, go to stderr.
- HTTP binds the host; use `--port 0` or distinct ports so parallel drives don't collide.
- `serve` never imports files by itself: `--source` mounts read-only at `/source`, and import happens only via `layerfs_project_init` or CLI `init`.
- The rebuild check compares `profile.image` as a string against `defaultImage(backend)`. The short form `layerfs-mcp:0.1.0` is the same image to Docker but a different string, so it takes the custom-image path and is never verified. Pass the full `docker.io/library/...` tag when the check matters.
