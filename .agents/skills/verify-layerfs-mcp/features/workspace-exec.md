# Workspace mount, exec, background processes

## Sub-features

- `workspace_mount` (FUSE mount of a branch) → returns `{ sandbox, path }`.
- `workspace_exec` runs a shell command inside the sandbox; checkable identity: uid 501, `CapEff: 0`, user-namespace creation must fail (no privilege escape).
- `workspace_status`, `operator_workspace_overlay`, `operator_workspace_changes` take `ws: { sandbox, path }`.
- `operator_process_start`/`process_list`/`process_cancel` for background processes.
- `workspace_commit` checkpoints the overlay onto the branch; `workspace_unmount` with `discard: true` drops uncommitted changes.

## How to get to it (user POV)

The agent mounts a branch as a live workspace, runs real commands (build, grep, scripts), starts long processes, checkpoints the result as a commit, and unmounts.

## Driving it with the MCP SDK

`helpers/drive.mjs --full` runs the canonical block from the repo's own `test/real/workflow.mjs`: mount `merged` → exec `printf 'from-command\n' > command.txt && cat command.txt` (exitCode 0, stdout matches) → identity command `id -u; grep '^CapEff:' /proc/self/status; if unshare -Ur true >/dev/null 2>&1; then exit 90; fi` (stdout starts `501\n`, `CapEff: 0`, exit 0) → `operator_process_start` `sleep 120` → `process_list` → `process_cancel` → `workspace_commit` → unmount `discard: true` in a `finally`. Afterwards read the committed file from `merged` to prove the checkpoint landed.

## Gotchas

- Needs FUSE (`/dev/fuse`) in the backend kernel. Docker Desktop may not expose it — if `workspace_mount` fails there, record it as an environmental gap in this file and prove on the apple-container backend instead; do not silently skip.
- The mount handle is the object `{ sandbox, path }` — later calls take it under `ws`, not a bare string.
- Always unmount (`finally`); a leaked mount keeps a sandbox alive past cleanup.
- `discard: true` throws away everything not committed — commit first when proving persistence.
