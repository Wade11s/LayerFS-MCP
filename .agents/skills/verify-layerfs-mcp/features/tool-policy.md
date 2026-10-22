# Tool policy: what the client sees

## Sub-features

- Base registry is 41 tools: 40 defined in the contract plus the hand-written `layerfs_status`. Annotations drive filtering: `enabledTools` keeps or drops each tool by `operator`, `readOnly`, and `exec`.
- `--read-only` keeps only read-only tools plus `layerfs_status`. It hides `operator_inspect_snapshot` and `operator_sandbox_list` (no read-only annotation) and removes the `layerfs_workflow` prompt.
- `--no-operator` drops every `operator.*` tool.
- `--disable-exec` drops `workspace_exec`, `operator_process_start`, and `operator_process_cancel`; mount, commit, and unmount remain.
- The resulting policy is published in the server capabilities, so a client can read it without probing.
- Restrictions apply to the outer process's tool registration. The inner runtime is started with all tools enabled; the filter is the outer server's job.

## How to get to it (user POV)

An operator running LayerFS-MCP against untrusted prompts starts it with `--read-only` and expects writes to be missing from the tool list, not merely refused at call time.

## Driving it with MCP SDK

Start `serve` with one flag at a time, list tools, and diff the counts:

```sh
node dist/cli.js serve --project p --read-only       # read-only tools + layerfs_status
node dist/cli.js serve --project p --no-operator     # no operator_* names
node dist/cli.js serve --project p --disable-exec    # no workspace_exec / operator_process_*
```

Assert by name set, not by count alone: a count match can hide a swapped tool. Check `capabilities.policy` reports the same policy the registry applied.

## Gotchas

- `layerfs_status` is always registered, even under `--read-only`.
- `--read-only` does not hide `operator_store_*` or `operator_files_*`; those carry the read-only annotation. It hides the two unannotated discovery tools.
- Flags are read from the environment (`LAYERFS_MCP_READ_ONLY`, `LAYERFS_MCP_OPERATOR`, `LAYERFS_MCP_DISABLE_EXEC`), set by the CLI from the flags. A drive that starts `serve` directly without the flags sees all 41.
- Native `init` and the branches resource bypass the policy filter, so a restricted server can still have those paths exercised internally.
