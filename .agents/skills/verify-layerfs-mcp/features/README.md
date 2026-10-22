# LayerFS-MCP feature map

What a user (an MCP client / AI agent) can do with the server, and how to prove each capability with a real client drive. One file per feature. When adding a feature, copy the shape (four H2s: Sub-features, How to get to it (user POV), Driving it with the MCP SDK, Gotchas).

| File | Proves | Quick drive |
|---|---|---|
| [serve-lifecycle.md](serve-lifecycle.md) | Cold serve, status lifecycle, concurrent clients, stop/restart persistence, HTTP transport | `helpers/drive.mjs` core + ad-hoc restart snippet |
| [files-and-branches.md](files-and-branches.md) | Init from source, fs edit suite, history, merge, publish, conflict errors | `helpers/drive.mjs` core (covers all of this) |
| [workspace-exec.md](workspace-exec.md) | FUSE mount, command exec + sandbox identity, background processes, checkpoint | `helpers/drive.mjs --full` |
| [operator-diagnostics.md](operator-diagnostics.md) | Store/file/overlay diagnostics, snapshots, init progress | ad-hoc after any drive's `--keep` run |

Shared preconditions for every drive: `npm run build` done; backend engine answering (`docker version` / `container system status`); fresh project name; temp `LAYERFS_MCP_CONFIG_DIR`; wait for `layerfs_status` → `ready` before any LayerFS call.
