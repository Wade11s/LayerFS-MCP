# Backends and deployment

[中文](../BACKENDS.md) · **English** · [Docs index](README.md)

The same MCP surface runs three ways. The first two are the everyday paths and are driven by `layerfs-mcp serve --backend ...`.

| Backend | Platforms | Store location | Docker required |
| --- | --- | --- | --- |
| `apple-container` | macOS (tested on Apple Silicon) | ext4 named volume inside the project VM | No |
| `docker` | Linux, Docker Desktop on macOS, Windows via a Linux container | Docker named volume | Yes |
| `native` | Linux hosts with an existing LayerFS deployment | local ext4 / xfs / btrfs | Not managed by MCP; bring your own |

All three expose the same tools and arguments to the agent. They differ in where the runtime lives, where the store lives, and who owns the lifecycle.

## Apple Container (recommended on macOS)

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
layerfs-mcp init --project website
layerfs-mcp status --project website
```

The Mac needs only Node.js 22+, npm and a running Apple Container service. One Linux VM per project; Podman/crun inside the VM runs every workspace against one shared store. Architecture, permission model, custom images and compatibility limits are in [Apple Container backend](APPLE-CONTAINER.md).

## Docker (managed mode)

```sh
layerfs-mcp serve --backend docker --project website --source /absolute/path/website
layerfs-mcp init --project website
```

For Linux hosts and Docker Desktop that already have Docker. Managed mode prepares the MCP control container, image and volumes; sandboxes and background processes stay under LayerFS.

## Docker Compose (manual deployment)

Use this when you want to see the containers and own the volumes and ports. Requires Node.js 22+, npm, a running Docker Engine / Desktop, and `/dev/fuse` from the Docker kernel (full workspaces need it).

```sh
npm ci
npm test
docker build -t layerfs-mcp:local .
npm run docker:configure
```

`docker:configure` writes a mode-0600 `.env` with a random bearer token and the immutable ID of the local image, and refuses to overwrite an existing file. You can also copy `.env.example` and fill it in by hand. A cold build downloads the base image and Rust dependencies.

macOS / Docker Desktop:

```sh
docker compose up -d --no-build
```

Linux (host networking reaches the daemon port published on the Docker host loopback):

```sh
docker compose -f compose.yaml -f compose.linux.yaml up -d --no-build
```

The HTTP endpoint is `http://127.0.0.1:8787/mcp` with `Authorization: Bearer <.env LAYERFS_MCP_TOKEN>`; the port is published to the local machine only by default.

First use: import the example project explicitly, then check the connection.

```sh
node examples/client.mjs --init /source
node examples/client.mjs
```

`/source` is a directory inside the service container, mounted read-only from `LAYERFS_SOURCE_DIR` by Compose. To import a real project, change that path in `.env` and restart before the first init. Starting the service never initializes or overwrites a project; initializing an existing one returns the upstream `Exists`.

### stdio client

Replace the path in [examples/mcp-stdio.json](../../examples/mcp-stdio.json) with this repository's absolute path:

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "docker",
      "args": [
        "compose", "--project-directory", "/absolute/path/LayerFS-MCP",
        "run", "--rm", "--no-deps", "-T",
        "layerfs-mcp", "--transport", "stdio"
      ]
    }
  }
}
```

On Linux, add `-f /absolute/path/LayerFS-MCP/compose.yaml -f /absolute/path/LayerFS-MCP/compose.linux.yaml` before `run`. Each client may start its own MCP process; they share project history through the same named volumes, so the HTTP service does not need to be running. After initialization, `node examples/stdio-client.mjs` verifies this path.

### HTTP client

[examples/mcp-http.json](../../examples/mcp-http.json) shows the common shape; [examples/client.mjs](../../examples/client.mjs) is a code example. Remote clients that only support OAuth login and cannot set a custom bearer header should connect through their local stdio mode.

## Native Linux mode

For Linux hosts with an existing LayerFS deployment. The SDK is not on npm, so build the pinned upstream first:

```sh
git clone https://github.com/Ephemeral-AI-Lab/layerfs.git /absolute/path/layerfs
git -C /absolute/path/layerfs checkout 5fb68ddc1acc3163e3ac3486133bde014c5fbed3
cd /absolute/path/layerfs
cargo +1.85.1 fetch --manifest-path core/Cargo.toml --locked
npm --prefix sdk/js run build:native
cargo +1.85.1 build --manifest-path core/Cargo.toml --locked --release -p layerfs-daemon
```

Configure the store and deployment per the upstream [SDK guide](https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/sdk/js/README.md), then:

```sh
cd /absolute/path/LayerFS-MCP
npm ci
npm run build
export LAYERFS_SDK_PATH=/absolute/path/layerfs
export LAYERFS_MCP_PROJECT=website
export LAYERFS_HOME=/absolute/private/layerfs-home
export LAYERFS_STORE_PATH=/absolute/local/store-volume/global/store.sqlite
# Full workspaces also need LAYERFS_IMAGE, LAYERFS_VOLUME, LAYERFS_DAEMON; see Configuration.
node dist/cli.js doctor
node dist/cli.js --transport stdio
```

A native store only works on ext4 / xfs / btrfs sharing the daemon's Linux kernel. With Docker, the store path must live inside the same Docker named volume the sandbox uses (find it with `docker volume inspect`). Do not put the store on a macOS bind mount, NFS or SMB. On macOS use the Apple backend; Windows clients should reach a Linux container or a remote Linux service.

## Multiple projects and multiple agents

- One service instance serves one project. Another project needs a different project name, home, store volume, container prefix and port; renaming the project while reusing the same store file does not work.
- Several agents can share one project, each on its own branch and workspace.
- The legacy `apple ...` subcommands and Docker Compose deployment still work; new deployments should use the unified entry point.
