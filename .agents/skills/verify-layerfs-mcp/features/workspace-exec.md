# Workspace mount, exec, background processes

## Sub-features

- `workspace_mount` (FUSE mount of a branch) returns a handle `{ sandbox, path }`.
- `workspace_exec` runs a shell command inside the sandbox. Checkable identity: uid 501, `CapEff: 0`, and creating a user namespace must fail (no privilege escape).
- `workspace_status`, `operator_workspace_overlay`, `operator_workspace_changes` all take `ws: { sandbox, path }`.
- Background processes use `operator_process_start`, `operator_process_list` (no arguments), and `operator_process_cancel` (takes the returned `process` id, not `ws`).
- `workspace_commit` checkpoints the overlay onto the branch; `workspace_unmount` with `discard: true` drops uncommitted changes.

## How to get to it (user POV)

The agent mounts a branch as a live workspace, runs real commands (build, grep, scripts), starts a long process, checkpoints the result as a commit, and unmounts.

## Driving it with the MCP SDK

`helpers/drive.mjs --full` runs the canonical block from `test/real/workflow.mjs`: mount `merged` → exec `printf 'from-command\n' > command.txt && cat command.txt` (exitCode 0, stdout matches) → identity command `id -u; grep '^CapEff:' /proc/self/status; if unshare -Ur true >/dev/null 2>&1; then exit 90; fi` (stdout starts `501\n`, `CapEff: 0`, exit 0) → `workspace_status`, `operator_workspace_overlay`, `operator_workspace_changes` on the handle → `operator_process_start` `sleep 120` → `operator_process_list` → `operator_process_cancel` → `workspace_commit` → unmount `discard: true` in a `finally`. Afterwards read the committed file from `merged` to prove the checkpoint landed.

## Gotchas

- Needs FUSE (`/dev/fuse`) in the backend kernel. Verified working on this host's Docker 29.5.3 (the `--full` drive passes its 35 steps there). On a host without FUSE, `workspace_mount` fails; record it as an environmental gap with the engine version and prove on the apple-container backend instead rather than skipping silently.
- The mount handle is the object `{ sandbox, path }`; later calls take it under `ws`, not a bare string.
- Always unmount (`finally`); a leaked mount keeps a sandbox alive past cleanup.
- `discard: true` throws away everything not committed. Commit first when proving persistence.
- Tool names carry the `layerfs_` prefix and the dots become underscores: `operator_process_list`, `operator_process_cancel`. The bare `process_list` / `process_cancel` names do not exist.
