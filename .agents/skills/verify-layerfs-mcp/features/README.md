# LayerFS-MCP feature map

What a user (an MCP client, an operator at the CLI) can do with the server, and how to prove each capability with a real drive. One file per feature. When adding a feature, copy the shape: four H2s named `Sub-features`, `How to get to it (user POV)`, `Driving it with …`, and `Gotchas`.

| File | Proves | Quick drive |
|---|---|---|
| [serve-lifecycle.md](serve-lifecycle.md) | Cold serve, status lifecycle, image build/rebuild/pull decision table, stop-and-restart, stdio and HTTP with the real token rules | `helpers/drive.mjs` core + ad-hoc restart and HTTP snippets |
| [saved-profile.md](saved-profile.md) | `update` three-state rewriting, rename and backend refusals, creation stickiness, setup drift refusal, host command output shapes | real `setup` + two `update` calls in a temp config dir |
| [files-and-branches.md](files-and-branches.md) | Init from source, the fs edit and query suites, history, merge, publish, the `Conflict` error path | `helpers/drive.mjs` core (write path) |
| [workspace-exec.md](workspace-exec.md) | FUSE mount, exec plus sandbox identity, background processes, checkpoint, discard | `helpers/drive.mjs --full` |
| [operator-diagnostics.md](operator-diagnostics.md) | Store, file, overlay, snapshot and progress diagnostics, with their paging | ad-hoc after a `--keep` run |
| [tool-policy.md](tool-policy.md) | `--read-only`, `--no-operator`, `--disable-exec` filtering and the published policy | three `serve` runs with one flag each |

Shared preconditions for every drive: `npm run build` done; backend engine answering (`docker version` / `container system status`); a fresh project name; a temp `LAYERFS_MCP_CONFIG_DIR`; wait for `layerfs_status` → `ready` before any LayerFS call.

Coverage note: `helpers/drive.mjs` covers the write path of files-and-branches and the whole workspace block, not every tool in those files. `test/real/workflow.mjs` remains the reference for the full 40-method sweep.
