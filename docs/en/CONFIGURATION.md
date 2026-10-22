# Configuration

[中文](../CONFIGURATION.md) · **English** · [Docs index](README.md)

Configuration lives in three layers: CLI flags, environment variables, saved project settings. Precedence is listed at the end.

## Project settings

Stored under `LAYERFS_MCP_CONFIG_DIR`, default `~/.config/layerfs-mcp`, one file per project:

```text
~/.config/layerfs-mcp/projects/<project>.json
```

`serve`, `setup`, `init`, `status`, `doctor` and `stop` all read and write the same file. Backend selection on first use follows `--backend`, then `LAYERFS_MCP_BACKEND`, then a saved project file, then the platform default (Apple Container on macOS, Docker elsewhere).

Saved image, source, VM name and resource settings that change are rejected rather than silently replaced. To rewrite them explicitly:

```sh
layerfs-mcp update --project website --image docker.io/library/layerfs-mcp-apple:local
```

`update` rewrites the config file only; it does not rerun setup or delete volumes, and the backend's own drift checks still apply on the next `serve` / `setup`. A legacy hand-built Apple project can be registered by passing settings that match its image and resources.

A project name cannot migrate its store across backends. Use a new project for a new runtime.

## Environment variables

### Runtime and store

| Variable | Meaning |
| --- | --- |
| `LAYERFS_SDK_PATH` | The pinned LayerFS checkout or its `sdk/js` directory; already set in the Docker image |
| `LAYERFS_MCP_BACKEND` | `apple`, `docker` or `native`; prefer selecting it explicitly on the CLI |
| `LAYERFS_MCP_CONFIG_DIR` | Managed project config directory, default `~/.config/layerfs-mcp` |
| `LAYERFS_MCP_PROJECT` | Current project name, default `default` |
| `LAYERFS_STORE_PATH` | Linux-local store path; `/layerfs-store/global/store.sqlite` in containers |
| `LAYERFS_HOME` | Upstream private discovery directory, owned by the current user, mode 0700 |
| `LAYERFS_NATIVE` | Optional native addon path; the upstream SDK picks the default |
| `LAYERFS_IMAGE` | Immutable local `sha256:...` image ID already present in the Docker engine |
| `LAYERFS_VOLUME` | Existing local named volume shared by the sandbox and the MCP process |
| `LAYERFS_DAEMON` | Linux daemon file readable by the MCP process; the SDK passes it into sandboxes |
| `LAYERFS_DOCKER` | Local Docker socket, default `/var/run/docker.sock` |
| `LAYERFS_ENGINE` | Defaults to `docker`; the Apple runtime sets `podman` and configures a compatible socket inside the VM |
| `LAYERFS_DAEMON_HOST` | Address used to reach the daemon port; `127.0.0.1` on Linux host networking, `host.docker.internal` from Docker Desktop containers |
| `LAYERFS_CONTAINER_PREFIX` | Container name prefix that distinguishes deployments on one engine |
| `LAYERFS_MCP_STORE_POLICY` | Optional JSON: `smallFileThreshold`, `wholeFileDepth`, `chunkDepth`, `metadataDepth`; written to the store only at Init |
| `LAYERFS_TRACE`, `LAYERFS_TRACE_STEP`, `LAYERFS_TRACE_START` | Upstream call tracing, passed through unchanged |

### Transport and access control

| Variable | Meaning |
| --- | --- |
| `LAYERFS_MCP_TRANSPORT` | `stdio` (default) or `http` |
| `LAYERFS_MCP_HOST`, `LAYERFS_MCP_PORT` | HTTP default `127.0.0.1:8787`, endpoint `/mcp` |
| `LAYERFS_MCP_TOKEN` | HTTP bearer token; required when binding beyond loopback |
| `LAYERFS_MCP_BODY_LIMIT` | HTTP JSON body limit, default `64mb`; stdio is still bounded by the client |
| `LAYERFS_MCP_READ_ONLY=1` | Register only tools with read semantics |
| `LAYERFS_MCP_OPERATOR=0` | Hide every operator tool |
| `LAYERFS_MCP_EXEC=0` | Hide command execution and background process tools |

### Locating container CLIs

| Variable | Meaning |
| --- | --- |
| `LAYERFS_CONTAINER_BIN` | Absolute path to the Apple Container CLI, for GUI clients |
| `LAYERFS_DOCKER_BIN` | Absolute path to the Docker CLI, for GUI clients |

## CLI flags

`--backend`, `--source`, `--image`, `--sandbox-image`, `--sandbox-archive`, `--name`, `--cpus`, `--memory`, `--project`, `--sdk-path`, `--store-path`, `--transport`, `--host`, `--port`, `--read-only`, `--no-operator`, `--disable-exec`. Flags take precedence over the matching environment variable. Run `layerfs-mcp --help` for the exact set in your version; lifecycle details are in [Unified CLI](CLI.md).

## Tool exposure switches

All three apply to both transports and both managed backends:

```sh
layerfs-mcp serve --project website --read-only          # reads only
layerfs-mcp serve --project website --no-operator        # hide operator
layerfs-mcp serve --project website --disable-exec       # no exec, no background processes
```

Read-only mode withholds the mutating workflow prompt, and `layerfs://capabilities` lists the methods actually enabled under the current configuration. Have the agent read that resource to confirm a tightened setup.

## Precedence

1. Command-line flags.
2. Environment variables.
3. Saved project settings.
4. Platform defaults.

If `LAYERFS_SDK_PATH` or `--sdk-path` is set and no backend is chosen explicitly, commands run in native Linux mode.

## HTTP security defaults

- `Origin` is validated; loopback listeners also validate `Host` to block DNS rebinding.
- Deploy behind a TLS reverse proxy with an explicit `LAYERFS_MCP_TOKEN` for anything beyond the local machine.
- The token is a shared service credential, not multi-tenant authorization. Branches and workspaces isolate work; the service provides no tenant permission boundary.
- There is no OAuth authorization server and no legacy HTTP+SSE transport. Remote clients that only support OAuth login should connect through their local stdio mode.
