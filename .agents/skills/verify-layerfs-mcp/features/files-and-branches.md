# Files, branches, history

## Sub-features

- Project import (`layerfs_project_init` from `/source`, `/example-seed`, or a host path), branch fork and list.
- Edit suite: `fs_write`, `fs_edit` (exact unique text replace), `fs_apply` (atomic batch), `fs_cp`/`fs_mv`/`fs_rm`, `fs_mkdir`. `fs_apply` op union is `write`/`edit`/`mkdir`/`rm`/`cp`/`mv`, and a write may carry `{ content, encoding: "base64" }` for binary payloads.
- Query suite: `fs_read`, `fs_list`, `fs_stat`, `fs_grep`, `fs_glob`, `fs_blame`, `fs_diff_files`.
- History: `branch_list_commits` (`items[].id` are commit ids, newest first along the first-parent chain), `branch_diff_commits`, `branch_diff_branches`.
- `branch_merge` → `branch_publish` → changes readable on `main`; the new layer id is at `structuredContent.result.publishedLayer.id`.
- Conflicting merges return `isError: true` with `structuredContent.error.code === "Conflict"` (the error object lives under `structuredContent`, never at the top level).
## How to get to it (user POV)

The agent asks LayerFS to import a directory, edits files on a branch, merges, publishes to main, and greps or blames history. That is git-shaped work driven through chat, and `main` only moves on publish.

## Driving it with the MCP SDK

`helpers/drive.mjs` runs the write path of this feature: init → fork alpha/beta → `fs_write` + `fs_edit` on alpha → `fs_apply` on beta → read-back → `branch_list_commits` → `branch_diff_branches` → merge → publish → read `main` → conflict assertion. It does **not** drive `project_list_branches`, `fs_mkdir`/`fs_cp`/`fs_mv`/`fs_rm`, `fs_list`/`fs_stat`/`fs_grep`/`fs_glob`/`fs_blame`/`fs_diff_files`, or `branch_diff_commits`; `test/real/workflow.mjs` covers those and is the reference for their argument shapes. Every write is proven by a read-back from the ref that should contain it.

## Gotchas

- Wait for `runtimeState: "ready"` first; during `preparing` every call above returns `RuntimePreparing`.
- Paths are absolute from the project root (`/a.txt`, `/data/b.txt`).
- `fs_edit` fails unless `oldText` matches exactly once. That is the contract, not a harness bug.
- **`main` is read-only.** Writing to it returns `ReadOnly: main changes only through publish`. Fork first, edit the fork, then publish.
- `branch_merge` requires two different sources; merging a branch with itself returns `InvalidInput: merge takes two different sources`.
- Re-`project_init` on an existing project returns the upstream `Exists` error (expected failure path).
- Error payloads are nested: `structuredContent.error.{code,message,detail}`. Reading a top-level `error` yields undefined.
