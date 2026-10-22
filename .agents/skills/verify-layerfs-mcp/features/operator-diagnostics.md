# Operator diagnostics

## Sub-features

- Store-level: `operator_store_stats`, `operator_store_commits { branch }`, `operator_store_overwritten { layer }`.
- File-level: `operator_files_stats`, `operator_files_history` (both `{ ref, path }`).
- Global: `operator_inspect_snapshot`, `operator_sandbox_list`, `operator_process_list`, `operator_project_progress` (null once init finished).

## How to get to it (user POV)

The agent (or an operator) asks for storage stats, layer history, and runtime inventory to explain space usage, dedup behavior, or leftover sandboxes.

## Driving it with the MCP SDK

Easiest on a `--keep` drive (instance stays up), or extend the ad-hoc snippet from SKILL.md after `ready`. Sequence that proves real data: `branch_publish` → keep `publishedLayer.id` → `operator_store_overwritten { layer: <id> }` returns the layer's overwrite chain; `operator_store_commits { branch: "merged" }` lists the merge; `operator_files_history { ref: "main", path: "/a.txt" }` shows the edit trail created by the files-and-branches journey.

## Gotchas

- `operator_store_overwritten` needs a real layer id — take it from a `branch_publish` result, never invent one.
- `operator_project_progress` is null unless an import is actually running; null here is the *pass* value after init.
- Operator tools can be hidden in restricted deployments; a verification drive must run the default (visible) configuration.
