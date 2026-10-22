# Files, branches, history

## Sub-features

- Project import (`layerfs_project_init` from `/source`), branch fork/list.
- Edit suite: `fs_write`, `fs_edit` (exact text replace), `fs_apply` (atomic batch: mkdir/write incl. base64 binary), `fs_cp`/`fs_mv`/`fs_rm`, `fs_mkdir`.
- Query suite: `fs_read`, `fs_list`, `fs_stat`, `fs_grep`, `fs_glob`, `fs_blame`, `fs_diff_files`.
- History: `branch_list_commits` (`items[].id` are commit ids), `branch_diff_commits`, `branch_diff_branches`.
- `branch_merge` → `branch_publish` → changes readable on `main`; conflicting merges return `isError: true`, `error.code: "Conflict"`.

## How to get to it (user POV)

The agent asks LayerFS to import a directory, edits files on a branch, merges, publishes to main, and greps/blames history — like a user driving git-shaped workflows through chat.

## Driving it with the MCP SDK

`helpers/drive.mjs` core journey is exactly this feature (init → fork alpha/beta → write+edit on alpha → apply on beta → read-back → commits/diffs → merge → publish → read on `main` → conflict assertion). For extra coverage, `fs_grep { ref: "alpha", pattern: "alpha", path: "/" }` and `fs_blame { ref: "alpha", path: "/a.txt" }` are safe additions. Every write must be proven by a read-back from the ref that should contain it; the published layer id (`branch_publish` → `structuredContent.result.publishedLayer.id`) must be a string and feeds `operator_store_overwritten`.

## Gotchas

- Wait for `runtimeState: "ready"` first; during `preparing` every call above returns `RuntimePreparing`.
- Paths are absolute from project root (`/a.txt`, `/data/b.txt`).
- `fs_edit` fails if `oldText` is not an exact unique match — that is the contract, not a harness bug.
- Re-`project_init` on an existing project returns upstream `Exists` (error path, expected).
- Binary content in `fs_apply` uses `{ content, encoding: "base64" }`.
