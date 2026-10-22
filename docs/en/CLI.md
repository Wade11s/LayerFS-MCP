# Unified CLI and npm distribution

[中文](../CLI.md) · **English** · [Docs index](README.md)

`layerfs-mcp <action>` is the only entry point. Start with the [Quickstart](QUICKSTART.md). This page is the reference for commands, lifecycle and packaging.

The unified command is `layerfs-mcp <action> --backend apple-container|docker|native --project <name>`. `apple-container` is the recommended spelling and `apple` is a compatible alias. Saved project settings and state that say `apple` keep working. The Apple and Docker managed backends support the same `serve`, `setup`, `init`, `status`, `doctor` and `stop`, over both stdio and Streamable HTTP.

## Start directly, no setup required

From a repository checkout run `npm ci && npm run build`, then `npm link` to put `layerfs-mcp` on the global npm command path. Published versions start straight from the registry:

```sh
npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website
bunx --package layerfs-mcp@0.1.0 layerfs-mcp serve --backend apple-container --project website
```

Docker users replace `--backend apple-container` with `--backend docker`. Later starts can omit the backend:

```sh
layerfs-mcp serve --project website
```

`serve` saves the project settings, checks the engine, prepares the image and creates the volumes and runtime it needs. When the default image is missing it builds the pinned LayerFS from the source, lock file and Dockerfile shipped in the npm package. It needs no repository checkout. `--image` selects a custom runtime image, either local or pulled from a registry. The default image tag carries the package version. An existing project keeps its saved image, so a package update never silently swaps the runtime.

macOS still needs Apple Container. Docker mode needs a working Linux Docker Engine or Docker Desktop. Both require Node.js 22+. `npx` / `bunx` fetch and start the MCP package. The first image preparation still needs network, disk space and a container engine. `bunx` follows the package's Node shebang and still runs under Node. This project neither requires nor tests `bunx --bun`.

Sources: [npm npx docs](https://docs.npmjs.com/cli/v10/commands/npx/), [Bun bunx docs](https://github.com/oven-sh/bun/blob/main/docs/pm/bunx.mdx).

## Cold start and optional prewarming

The MCP handshake and tool list complete before the background build starts. `layerfs_status` reports:

| runtimeState | Meaning |
| --- | --- |
| `preparing` | Waiting for the project lock, checking the engine, preparing or building the image, starting the runtime, or connecting the internal MCP |
| `ready` | LayerFS methods can be called |
| `failed` | A concrete error is reported. Fix the environment and reconnect. Failed SDK operations are never retried automatically |

LayerFS calls during preparation return `RuntimePreparing` immediately. They are not queued, not written, and not run later behind your back. The agent should check the state and reissue the operation once it is `ready`. Build output goes to stderr only. Stdout stays reserved for MCP.

`setup` exists purely to prepare ahead of time, for setups where the first agent connection must be instantly usable:

```sh
layerfs-mcp setup --backend apple-container --project website --source /absolute/path/website
```

Several agents starting for the first time share the persisted project settings. Image builds and runtime creation are serialized by an inter-process lock. The npm cache is not project state.

## Preparing a runtime is not importing a project

Neither `serve` nor `setup` imports files. On first creation, mount the directory read-only at `/source` with `--source`, then import explicitly:

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
# in another terminal, or let the agent call layerfs_project_init({sourcePath:"/source"})
layerfs-mcp init --project website
```

With no configured source, `init` imports the package's example seed. Agents can use `/example-seed` as the import source. Initializing an existing project returns the upstream `Exists`. The agent's working directory is never treated as an import source automatically.

## Configuration and lifecycle

Settings live in `~/.config/layerfs-mcp/projects/<project>.json`. `LAYERFS_MCP_CONFIG_DIR` relocates them. First-use selection follows `--backend`, `LAYERFS_MCP_BACKEND`, an existing project file, then the platform default (Apple on macOS, Docker elsewhere). When `LAYERFS_SDK_PATH` or `--sdk-path` is set, commands that do not name a backend use native Linux mode.

```sh
layerfs-mcp status --project website
layerfs-mcp doctor --project website
layerfs-mcp stop --project website
layerfs-mcp serve --project website --read-only
```

A project name cannot migrate its store by changing `--backend`. Changed saved image, source, VM name and resource settings are rejected explicitly. Use a new project, or manage the existing runtime and settings yourself. To rewrite saved settings on purpose, use `update --project <name>`: it only rewrites the config file, never reruns setup or deletes volumes, and the backend's own drift rejection still applies on the next `serve` / `setup`. Legacy hand-built Apple projects can be registered with matching image and resource settings, for example the original default example with `serve --backend apple-container --project default --image docker.io/library/layerfs-mcp-apple:local`.

`stop` keeps data volumes. Apple stops the whole project VM, terminating its sandboxes and background processes. Docker stops the project's MCP control container while sandboxes and background processes stay under LayerFS, so commit, unmount or cancel through the workspace and process tools first when needed. A later `serve` starts the same environment. A client exiting only closes its own MCP connection. Each in-container MCP process uses its own temporary directory so PID reuse after a restart cannot collide on temporary overlay directories.

Native mode uses an existing Linux SDK, store and container executor. `setup` / `stop` do not manage its external infrastructure. The legacy `apple ...` subcommands and Docker Compose deployment remain, but new deployments should use the unified entry point.

## MCP client configuration

Once published:

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "npx",
      "args": ["-y", "layerfs-mcp@0.1.0", "serve", "--backend", "apple-container", "--project", "website"]
    }
  }
}
```

With a local or linked install, use `command: "layerfs-mcp"` and start args at `serve`. Bun users can use `command: "bunx"` with args starting at the package name. GUI clients must find Node and the chosen container CLI on PATH. Alternatively, set absolute paths via `LAYERFS_CONTAINER_BIN` / `LAYERFS_DOCKER_BIN`.

HTTP uses the same entry point: the server listens on the host and still reaches the project runtime over stdio internally.

```sh
layerfs-mcp serve --backend apple-container --project website --transport http --host 127.0.0.1 --port 8787
```

Bearer tokens, Host/Origin checks and non-loopback authentication behave as before. Read-only, operator hiding and exec disabling apply to both backends and both transports.

## Packaging and verification

`npm pack` ships the executable dist, the full image build sources, `npm-shrinkwrap.json`, the pinned upstream patch and configuration. It can run the CLI and build the runtime without a repository checkout. Verify a local tarball before releasing:

```sh
npm pack
npx -y --package ./layerfs-mcp-0.1.0.tgz layerfs-mcp --help
bunx --package ./layerfs-mcp-0.1.0.tgz layerfs-mcp --help
npm run test:managed
# verify the other backend:
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

`test:managed` runs without setup and uses a temporary project with the official MCP client to check cold start, concurrent clients, all 40 methods, host-side HTTP access, settings reuse and access after stop, then cleans up the runtime and volumes it created. Publishing to npm is a separate step. A successful pack does not mean the package is published.
