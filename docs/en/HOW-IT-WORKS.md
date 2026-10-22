# How it works

[中文](../HOW-IT-WORKS.md) · **English** · [Docs index](README.md)

## Pinned upstream

- Pinned upstream commit: [`5fb68ddc1acc3163e3ac3486133bde014c5fbed3`](https://github.com/Ephemeral-AI-Lab/layerfs/tree/5fb68ddc1acc3163e3ac3486133bde014c5fbed3), recorded in [upstream.lock.json](../../upstream.lock.json).
- That commit manages workspaces with `workspace.*`, so there are 27 public methods. The "29 methods" in the upstream README refers to the older `sandbox.*` contract.
- Every call goes to the real upstream SDK. Storage format, deduplication, checkpoints, `.lww` conflict rules and merge algorithms are all LayerFS. This project contains no simulated storage backend.
- `npm run verify:upstream` compares the actual exported method set. Upgrading upstream fails the check on any added or missing method.
- The native build additionally applies the recorded [Podman compatibility patch](../../patches/apple-container-podman.patch), enabled only by the Apple backend. The checksum is in the lock file.

## A typical workflow

1. **Check state.** `layerfs_status` reports configuration. Managed mode waits for `runtimeState=ready`.
2. **Import.** `layerfs_project_init({ "sourcePath": "/source" })` is an explicit write, and `serve` never does it for you.
3. **Fork.** `layerfs_branch_fork` gives each agent a branch. `main` only moves through publish.
4. **Edit.** `fs` writes create checkpoints automatically. `fs.apply` applies ordered edits atomically in one checkpoint.
5. **Run commands.** `workspace_mount → workspace_exec → workspace_commit → workspace_unmount`. Keep the `{sandbox,path}` returned by mount, and serialize operations on one workspace.
6. **Merge and publish.** Merge branches, then publish according to the task.

Things that bite:

- A failed command may still have modified files. Inspect and commit before unmounting. A dirty workspace refuses to unmount unless you pass `discard=true`.
- Shutting the service down never unmounts workspaces or cancels background processes on its own.
- To return to an older state, use an old commit or layer as `fork.fromRef`. Upstream exposes no in-place reset, project delete or GC.
- Cancel background work with the operator process methods, not by closing the connection.

## Results and errors

Success returns `{ "result": <upstream value> }` in both `structuredContent` and text content. Failure sets `isError=true` and preserves `code / message / detail`.

The bridge never trims silently: pagination, conflict omission markers, `null` metrics and full command output all pass through. Binary writes use `encoding: "base64"`. `fs.read` is text-only, so read binary content through workspace commands.

Per-tool arguments and fields are in [MCP API](API.md).

## Concurrency and lifecycle

- Each agent uses its own branch and workspace. Operations on one workspace must be sequential.
- The service never treats a client timeout as a rollback and never retries. `Unknown`, a timeout or a dropped connection does not mean the operation did not happen, nor that a native command stopped.
- On shutdown the service only calls upstream `close()` to release the store client. It does not discard workspaces.
- HTTP is sessionless Streamable HTTP. Every authorized client shares one project and store.

## Durability boundary

The upstream **Disposable Store makes no crash or power-loss durability guarantee**. It is fine for reconstructible intermediate state and wrong as the only copy. The MCP layer does not change this and does not back anything up: keep a rebuildable original of your data.

## Security boundary

The default full mode grants directory import, command execution and Docker permissions because that is what agents are meant to do with it. Connect only trusted agents. Branches and workspaces isolate work, but they are not a tenant boundary. To tighten the tool set, use `--read-only`, `--no-operator` and `--disable-exec`, described in [Configuration](CONFIGURATION.md).
