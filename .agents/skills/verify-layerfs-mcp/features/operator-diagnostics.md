# Operator diagnostics

## Sub-features

- Store-level: `layerfs_operator_store_stats`, `layerfs_operator_store_commits { branch, pageSize?, pagePos? }` (checkpoint records with storage diagnostics), `layerfs_operator_store_overwritten { layer, pageSize?, pagePos? }` (pages the layers a publication overwrote, newest first).
- File-level: `layerfs_operator_files_stats { ref, path }` returns `{size, revisions, revisionsMore, logical, canonical, stored, metadata}`; `layerfs_operator_files_history { ref, path, pageSize?, pagePos? }` pages revision diagnostics. Only `stats` takes the bare pair; `history` also pages.
- Global: `layerfs_operator_inspect_snapshot` (optional `since`), `layerfs_operator_sandbox_list`, `layerfs_operator_process_list`, `layerfs_operator_project_progress` (null once init finished).
- Default configuration exposes all of them; `--no-operator` hides every `operator.*` tool, and `--read-only` additionally hides `inspect_snapshot` and `sandbox_list` because they carry no read-only annotation.

## How to get to it (user POV)

The agent or an operator asks for storage stats, checkpoint history, and runtime inventory to explain space usage, dedup behavior, or leftover sandboxes.

## Driving it with the MCP SDK

Easiest on a `--keep` drive, or after `ready` in the ad-hoc snippet from SKILL.md. Sequence that proves real data: `branch_publish` → keep `structuredContent.result.publishedLayer.id` → `operator_store_overwritten { layer }` returns one page of overwritten layers; `operator_store_commits { branch: "merged" }` returns that branch's checkpoint records; `operator_files_history { ref: "main", path: "/a.txt", pageSize: 10 }` returns revision diagnostics; `operator_project_progress` returns null after init.

## Gotchas

- Registered names carry the prefix: `layerfs_operator_*`. `listTools` never shows the short `operator_store_stats` form, and `helpers/drive.mjs` adds the prefix itself while a raw SDK `callTool` does not.
- A single call returns one page shaped `{items, hasMore, nextPagePos}`. Do not describe the result as a complete overwrite chain or a full edit trail; pass `nextPagePos` as `pagePos` to walk further.
- `operator_store_commits` needs a real branch name. `main` is a published ref, not a queryable branch: asking for `{ branch: "main" }` returns `NoSuchBranch`. Query the branch you forked or merged.
- `operator_inspect_snapshot` and `operator_sandbox_list` are not read-only: upstream discovery may reclaim stopped Sandbox records, so treat them as a moving observation, not an inventory.
- `operator_store_overwritten` needs a real layer id taken from a publish result, never an invented one.
- `operator_project_progress` is null unless an import is running. Null after init is the pass value.
