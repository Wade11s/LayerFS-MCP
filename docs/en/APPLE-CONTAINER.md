# Apple Container backend

[中文](../APPLE-CONTAINER.md) · **English** · [Docs index](README.md) · [Backends](BACKENDS.md)

This backend runs one Apple Container VM per project. The Mac needs only Node.js 22+, npm and a running Apple Container service; building, starting and connecting need no Docker Engine or Docker Desktop.

The VM contains Podman/crun, which creates the LayerFS sandboxes. It exposes a Docker-compatible local Unix API but has no Docker Engine and no host Docker socket. Agents still call the same 40 LayerFS methods over standard MCP, plus `layerfs_status`.

## Why the sandbox runs in the same VM

Apple Container gives every outer container its own Linux VM. LayerFS's direct store mode requires all accessors to share one Linux kernel and a local ext4/xfs/btrfs volume to keep SQLite WAL and writer-lock semantics. Putting each workspace in its own Apple VM and reaching a shared store through a macOS shared folder is therefore not possible.

```text
macOS: agent -> layerfs-mcp serve --backend apple-container (MCP stdio / HTTP)
                         | container exec --interactive
                         v
          the project's Apple Container Linux VM
          |- MCP processes A, B... -> one LayerFS store
          |- Podman/crun -> sandbox A -> daemon / FUSE / workspace
          |- Podman/crun -> sandbox B -> daemon / FUSE / workspace
          \- /state: Apple ext4 named volume
             |- home: LayerFS private discovery directory
             \- engine: OCI images, sandbox metadata, store volume
```

Each agent's MCP process, store opener and sandbox daemon share that project VM's kernel. Projects use separate VMs and volumes; agents within one project collaborate through branches and workspaces. VirtioFS directories from the Mac are used only for read-only import; the store always lives on the ext4 named volume.

Sources: [Apple technical overview](https://github.com/apple/container/blob/main/docs/technical-overview.md), [Apple volumes](https://github.com/apple/container/blob/main/docs/volumes.md), [pinned LayerFS kernel guard](https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/core/crates/layerfs-store-service/src/kernel_guard.rs).

## Recommended entry: automatic preparation

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
layerfs-mcp init --project website
layerfs-mcp status --project website
```

Install the command locally with `npm ci && npm run build && npm link`, or start a published version with `npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website` or `bunx`. No manual `setup` or build is required; the first connection prepares everything, and the runtime is usable once `layerfs_status` returns `ready`. The unified entry point supports stdio and Streamable HTTP; configuration and usage are in [Unified CLI](CLI.md).

The `apple ...` subcommands below remain for legacy deployments and manual management; they differ from the automatic unified entry point.

## Manual build and initialization

From the repository:

```sh
container system start
npm ci
npm run build
container build --cpus 2 --memory 2G --target apple-runtime -t layerfs-mcp-apple:local .
node dist/cli.js apple setup --project default
node dist/cli.js apple init --project default
node dist/cli.js apple status --project default
```

`setup` creates a 2 CPU / 2 GiB VM and a 32 GiB sparse ext4 volume. The first preparation downloads the pinned-digest Node 22 sandbox image and stores an immutable image ID inside the VM. A cold build downloads the base image, upstream code and Rust/npm dependencies.

Neither `setup` nor `serve` initializes a project; `init` is the explicit write. With no import directory configured, `init` imports only the example seed shipped with the repository. Re-initializing an existing project returns the upstream `Exists`.

To import a real directory, name a read-only source when the project is first created:

```sh
node dist/cli.js apple setup --project website --source /absolute/path/website --cpus 4 --memory 4G
node dist/cli.js apple init --project website
```

Creation arguments only take effect when the VM is created; `setup` on an existing VM validates image, mount and resource settings, starts it and waits for readiness, and fails loudly on a mismatch. To change the import directory or VM resources, use a new project or manage that project's VM configuration yourself. The user home is not mounted by default.

## MCP configuration for legacy manual deployments

Replace the repository path with the real absolute path and add this to an MCP client that supports stdio:

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "node",
      "args": [
        "/absolute/path/LayerFS-MCP/dist/cli.js",
        "apple", "serve", "--project", "default"
      ]
    }
  }
}
```

If a GUI-launched client cannot find `node` or `container`, use Node's absolute path and set `LAYERFS_CONTAINER_BIN=/usr/local/bin/container` in the client's environment. Service logs go to stderr; stdout is MCP only. Each client can start its own stdio process and they connect to the same project VM; the VM and project survive client exit.

`apple serve` starts an already configured but stopped VM and never creates a new one implicitly. `--read-only`, `--no-operator` and `--disable-exec` restrict tools. The legacy `apple serve` subcommand is stdio only; the unified `serve --backend apple-container` supports stdio and Streamable HTTP and creates the runtime automatically.

The [Apple stdio example](../../examples/mcp-apple-stdio.json) is ready to use.

After initialization, `node examples/apple-client.mjs default` checks tool discovery, backend status and reading a sample file through the official MCP client.

## Lifecycle and custom images

```sh
node dist/cli.js apple serve --project default
node dist/cli.js apple stop --project default
# the next serve starts the same VM and reuses the same volume
node dist/cli.js apple --help
```

The VM name derives from the project name plus a hash and can be overridden with `--name`; later commands must use the same name. The CLI validates ownership labels, project, upstream version and volumes, and refuses to take over unrelated containers. The state volume is named `<VM name>-state`.

Stopping the VM terminates running sandboxes and background processes, so inspect and commit workspaces first. Keeping the data volume does not change the upstream Disposable Store property: there is no crash or power-loss durability guarantee, so keep an independent original of important data. This backend never migrates, deletes or takes over another deployment's store.

A custom sandbox image must satisfy the upstream runtime contract, for example a Linux glibc base with a runnable daemon and the required build and runtime tools. Set `--sandbox-image registry.example/image@sha256:...`. The image is pulled inside the VM and pinned to the actual image ID. Offline setups can additionally pass `--sandbox-archive /absolute/path/image.oci.tar` together with the in-archive reference in `--sandbox-image`. The archive is mounted read-only and kept for as long as the VM needs it. `--image` selects a LayerFS-MCP runtime image that was already built or loaded by Apple Container.

## Permissions and compatibility

The outer VM needs `--cap-add ALL --masked-path NONE --read-only-path NONE` so it can use namespaces, cgroups, OCI mounts and FUSE inside. Those permissions live inside the project VM; connect only trusted agents. Inside the sandbox, the upstream non-root identity, empty effective capabilities and the seccomp policy that forbids new user namespaces still apply.

The [compatibility patch](../../patches/apple-container-podman.patch) only applies when `LAYERFS_ENGINE=podman` is set explicitly, and handles seccomp file paths, inspect metadata normalization and log media type aliases. Podman 4.3's Docker-compatible inspect omits the FUSE device permission string; that mode accepts the empty field only for a single exact `/dev/fuse` mapping and still performs device path, mount, identity and real FUSE readiness checks. Logs are still validated by the original strict multiplexed frame parser. The default Docker path keeps its original checks.

Verified on: Apple Silicon, macOS 27.0.1, Apple Container 1.6.0, Linux 6.18.35, Podman 4.3.1 / crun 1.8.1 inside the VM. Other versions should run the standalone tests before use:

```sh
npm test
npm run test:apple
```

`test:apple` creates a temporary project VM, drives all 40 methods, FUSE, commands and background processes through the Mac CLI with the official MCP client, then verifies that a second independent client reads the same project; it cleans up only VMs and volumes it created and that pass the ownership check. It never touches a real project store.
