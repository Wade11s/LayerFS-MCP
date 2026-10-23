# Quickstart

[中文](../QUICKSTART.md) · **English** · [Docs index](README.md)

From zero to a first successful MCP call in about five minutes.

## 0. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 22+ | Runs the CLI and the MCP SDK |
| A container engine | macOS: [Apple Container](https://github.com/apple/container) (run `container system start` first). Linux / Windows: Docker Engine or Docker Desktop |
| Disk and network | The first start builds a pinned runtime image. Use `--image` to point at an image you already built for offline setups |

The Docker backend needs `/dev/fuse` from the Docker Linux kernel, otherwise workspace mounting is unavailable. The Apple backend does not need Docker.

## 1. Install

Pick one:

```sh
# No install
npx -y layerfs-mcp@0.1.0 --help
bunx --package layerfs-mcp@0.1.0 layerfs-mcp --help

# Global install
npm i -g layerfs-mcp@0.1.0

# From this repository
npm ci && npm run build && npm link
```

`npx` / `bunx` only fetch and start the MCP package. They do not install a container engine.

## 2. Start the server

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
```

- `--backend`: `apple-container` (alias `apple`), `docker` or `native`. Saved into the project file, so later starts can omit it.
- `--project`: one project gets its own store, volumes and container prefix. Defaults to `default`.
- `--source`: mounted read-only at `/source` inside the runtime for the import step. Without it, `init` imports the bundled example seed.

The first start builds the image and creates the runtime in the background. The MCP handshake, tool list and `layerfs_status` are available immediately. The state is `preparing` until that work finishes. LayerFS calls during preparation return `RuntimePreparing` right away. They are never queued or executed later.

To have the first agent connect to a ready runtime, prewarm once:

```sh
layerfs-mcp setup --backend apple-container --project website --source /absolute/path/website
```

## 3. Import the project

Neither `serve` nor `setup` imports files. Import is an explicit write:

```sh
layerfs-mcp init --project website
```

The agent can instead call `layerfs_project_init({ "sourcePath": "/source" })`. With no configured source, `init` imports the example seed (`/example-seed`). Initializing an existing project returns the upstream `Exists` result. It never overwrites or merges.

## 4. Connect an agent

stdio configuration (same as [examples/mcp-unified-stdio.json](../../examples/mcp-unified-stdio.json)):

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "layerfs-mcp",
      "args": ["serve", "--backend", "apple-container", "--project", "website"]
    }
  }
}
```

For `npx` see [examples/mcp-npx.json](../../examples/mcp-npx.json). If a GUI client cannot find `node` or the container CLI, use absolute paths or set `LAYERFS_CONTAINER_BIN` / `LAYERFS_DOCKER_BIN`.

HTTP:

```sh
export LAYERFS_MCP_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
layerfs-mcp serve --project website --transport http --host 127.0.0.1 --port 8787
```

Send requests to `http://127.0.0.1:8787/mcp` with `Authorization: Bearer $LAYERFS_MCP_TOKEN`. See [examples/mcp-http.json](../../examples/mcp-http.json) for the client shape. The token is required for any non-loopback bind.

## 5. Confirm it works

```sh
layerfs-mcp status --project website   # project, backend, state
layerfs-mcp doctor --project website   # config gaps and native addon load
```

The CLI prints `state`. The MCP tool `layerfs_status` reports `runtimeState`, with the same values of `preparing`, `ready` and `failed`.

On the agent side, call `layerfs_status` first, then `layerfs_project_list_branches`. A returned `main` means the store is open and the import succeeded.

To exercise the protocol, every method, concurrent clients and restarts in one go:

```sh
npm run test:managed
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

## 6. Stop and resume

```sh
layerfs-mcp stop --project website
```

`stop` keeps the data volumes. A later `serve` starts the same environment against the same store. For the Apple backend, `stop` shuts down the whole project VM, which terminates its sandboxes and background processes. Commit workspaces first.

## Next

- Give every agent its own branch and workspace: [How it works](HOW-IT-WORKS.md).
- Tighten the tool set (read-only, hide operator, disable exec): [Configuration](CONFIGURATION.md).
- Manual Docker Compose deployment or native Linux mode: [Backends](BACKENDS.md).
