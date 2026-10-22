# LayerFS-MCP

**English** · [中文](README.md)

Give any MCP-capable agent standard tools over [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs): shared history, isolated workspaces, automatic checkpoints, branches, merges, publishing and deduplicated storage.

One server instance serves one project and exposes **41 tools** (27 LayerFS public methods, 13 operator methods, 1 status tool), 3 resources and 1 workflow prompt over **stdio** and **Streamable HTTP**.

## Quick start

Requires Node.js 22+ and a container engine: [Apple Container](https://github.com/apple/container) on macOS, Docker Engine / Docker Desktop elsewhere.

```sh
# First run: name an import source, the runtime prepares itself (no manual setup)
npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website --source /absolute/path/website

# In another terminal: import explicitly (serve never imports for you)
npx -y layerfs-mcp@0.1.0 init --project website

# Afterwards the settings are saved, so start with just the project
npx -y layerfs-mcp@0.1.0 serve --project website
```

Docker users replace `--backend apple-container` with `--backend docker`.

`serve` completes the MCP handshake and lists tools immediately. While the first image builds, `layerfs_status` reports `preparing`. Once it flips to `ready`, LayerFS methods are callable. Full install, import and verification steps are in the [Quickstart](docs/en/QUICKSTART.md).

### Connect an agent

Add this to your client's MCP configuration (or use [examples/mcp-unified-stdio.json](examples/mcp-unified-stdio.json) directly):

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

Without a global install, set `command` to `npx` and start the args with `-y`, `layerfs-mcp@0.1.0` (see [examples/mcp-npx.json](examples/mcp-npx.json)). For remote or shared access, use Streamable HTTP:

```sh
layerfs-mcp serve --project website --transport http --host 127.0.0.1 --port 8787
# endpoint http://127.0.0.1:8787/mcp, header Authorization: Bearer <LAYERFS_MCP_TOKEN>
```

## What it does

| Capability | Tool group |
| --- | --- |
| Initialize a project from a directory, list branches | `layerfs_project_*` |
| Line reads, directory listing, metadata, grep, glob, file diffs, blame | `layerfs_fs_*` |
| Text and binary writes, exact edits, atomic batch edits, directories, delete, copy, move | `layerfs_fs_*` |
| Fork from any historical state, commit history, diffs, merges, publish | `layerfs_branch_*` |
| FUSE workspace mount, command execution, status, commit, unmount | `layerfs_workspace_*` |
| Store, file and overlay diagnostics, history snapshots, init progress | `layerfs_operator_*` |
| Background process start, list and cancel | `layerfs_operator_process_*` |

Storage format, deduplication, checkpoints, `.lww` conflict rules and merge algorithms all come from upstream LayerFS. This project contains no simulated storage backend. Full arguments and semantics are in the [MCP API](docs/en/API.md).

## Documentation

| I want to… | Read |
| --- | --- |
| Get running and connect an agent in five minutes | [Quickstart](docs/en/QUICKSTART.md) |
| Look up tools, arguments and result shapes | [MCP API](docs/en/API.md) |
| Manage images, projects, HTTP and lifecycle from the CLI | [Unified CLI](docs/en/CLI.md) |
| Configure environment variables, project settings, access control | [Configuration](docs/en/CONFIGURATION.md) |
| Choose between Apple, Docker and native Linux | [Backends](docs/en/BACKENDS.md) |
| Understand checkpoints, branches, merges and concurrency | [How it works](docs/en/HOW-IT-WORKS.md) |
| Run tests and see what has been verified | [Testing](docs/en/TESTING.md) |
| Diagnose a failed start, import conflict or refused connection | [Troubleshooting](docs/en/TROUBLESHOOTING.md) |
| Publish to npm | [Releasing](docs/en/RELEASING.md) |

Chinese docs live in `docs/`, English docs in `docs/en/`, page for page.

## Boundaries

- The default full mode grants directory import, command execution and Docker permissions. Connect only trusted agents. Branches and workspaces isolate work, but they are not a tenant permission boundary.
- The service never retries. A timeout or dropped connection does not mean the operation did not happen. Check processes, workspaces and commit history first.
- The upstream **Disposable Store makes no crash or power-loss durability guarantee**. Keep a rebuildable original of important data. The MCP layer does not change this.
- One instance serves one project. For another project, use a different project name, home, store volume, container prefix and port.

## Development

```sh
npm ci
npm run build
npm run check      # tsc --noEmit
npm test           # protocol, schemas, argument conversion, pagination, errors, stdio and HTTP
```

Tests that need a real store, FUSE or a container engine are in [Testing](docs/en/TESTING.md).

MIT licensed. Upstream and dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
