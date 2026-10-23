# Troubleshooting

[中文](../TROUBLESHOOTING.md) · **English** · [Docs index](README.md)

Start with these two. Once the project is configured they print the project, the backend and the runtime state, and add a diagnostics report while the runtime is running. Before that they print only the project name and `state: not-configured`. When diagnostics find a gap the command exits non-zero and prints a `Command failed` error instead of the report.

```sh
layerfs-mcp status --project <name>
layerfs-mcp doctor --project <name>
```

## Startup and state

**Stuck in `preparing`.** The first start builds an image and creates a runtime in the background. A cold start downloads the base image and Rust dependencies. Watch stderr. Build output goes there, and stdout stays reserved for MCP. When several agents start for the first time, image build and runtime creation are serialized by an inter-process lock, so the second client waits for the first.

**`runtimeState=failed`.** That field comes from the MCP tool `layerfs_status`. The state carries the concrete error. Fix the environment and reconnect. Failed SDK operations are never retried automatically.

**A call returns `RuntimePreparing`.** The runtime is not ready yet. The call is not queued and will not run later behind your back. Reissue it once the state is `ready`.

**`status` passes but tool calls fail.** `status` and `doctor` run the same check. They read the project configuration and report the runtime state and any gaps, without opening the store or starting a sandbox. Passing configuration checks does not mean Docker, FUSE and the store have actually been exercised.

## Import

**`init` returns `Exists`.** The project was already initialized. Upstream has no in-place reset or project delete API. Create a new project to import again.

**The wrong directory was imported.** `serve` / `setup` never import automatically and never treat the agent's working directory as a source. Name `--source /absolute/path` when the project is first created so it is mounted read-only at `/source`, then run `init`. For an existing project the source is saved configuration, and changing it is rejected explicitly.

**Files appeared without a source.** With no source configured, `init` imports the bundled example seed at `/example-seed`.

## Engines and platforms

**A macOS GUI client cannot find `node` or `container`.** Use absolute paths and set `LAYERFS_CONTAINER_BIN=/usr/local/bin/container` (or `LAYERFS_DOCKER_BIN`).

**Docker cannot mount a workspace.** The Docker Linux kernel must provide `/dev/fuse`. Without FUSE you are limited to reads and writes that do not mount a workspace.

**Native mode rejects the store.** A native store only works on ext4 / xfs / btrfs sharing the daemon's Linux kernel. With Docker, the store must live in the same named volume the sandbox uses. Do not put it on a macOS bind mount, NFS or SMB. On macOS, use the Apple backend.

**Changing `--backend` looks like data loss.** A project name cannot migrate its store across backends. Create a new project.

**Changed image / source / resource settings are rejected.** That is drift protection by design. To rewrite them, use `layerfs-mcp update --project <name>`: it only rewrites the config file, does not rerun setup and does not delete volumes.

## Client connection

**The remote client only supports OAuth login.** This service has no OAuth authorization server and no legacy HTTP+SSE. Let that client connect through its local stdio mode, or front the service with a proxy that injects the bearer header.

**HTTP connection refused.** Any non-loopback bind requires `LAYERFS_MCP_TOKEN`. A reverse proxy must forward `Host` / `Origin` correctly. The port is published to the local machine only by default.

**Clients interfere with each other.** They share one project and store. Give each agent its own branch and workspace, and serialize operations on a single workspace.

## While running

**A command timed out. Did it take effect?** The service never treats a timeout as a rollback and never retries. Check processes, workspaces and commit history before retrying or cancelling.

**Unmount was refused.** A dirty workspace refuses to unmount. Inspect and commit first. Pass `discard=true` explicitly when you really mean to throw away uncommitted content.

**A background process is still running.** Shutting the service down does not cancel background processes. List and cancel them with the operator process methods.

**Is data still there after stop?** `stop` keeps the data volumes and a later `serve` starts the same environment. But the upstream Disposable Store has no crash or power-loss durability guarantee. Keep a rebuildable original of important data.

**Sandboxes vanished after an Apple `stop`.** The Apple backend stops the whole project VM, which terminates its sandboxes and background processes. Commit workspaces before stopping.

## Still stuck

- Open the matching test in [Testing](TESTING.md) and reproduce with a temporary project and volume.
- `npm run test:managed` tells you whether the problem is CLI lifecycle or a specific tool call.
- The Apple and Docker diagnostics (`layerfs_operator_store_stats`, `files_stats`, `workspace_overlay`, `inspect_snapshot`, `project_progress`) separate import, overlay and store-layer problems.
