# MCP API

[中文](../API.md) · **English** · [Docs index](README.md)

Reference for all 41 tools, 3 resources and 1 workflow prompt. Workflow-level conventions are in [How it works](HOW-IT-WORKS.md).

A tool name takes the upstream method, replaces `.` with `_` and adds a `layerfs_` prefix: `fs.read` is `layerfs_fs_read`. Each tool is a discrete standard MCP tool with a JSON object as arguments; there is no generic execute-any-method entry point. One MCP server instance is bound to one project.

Every tool returns `{ "result": <upstream value> }` on success, in both `structuredContent` and text content. Failure returns `isError: true` with `{ "error": { "code", "message", "detail" } }`. Arguments rejected by the MCP SDK also come back as tool errors, possibly with text content only.

Shared arguments:

- `ref`: `main`, a branch name, a commit ID or a layer ID; write operations take `branch`.
- `path`, `from`, `to`: absolute paths inside the LayerFS view; `project.init.sourcePath` is an absolute path on the MCP host.
- `pageSize?`: 1–1000, default 50; `pagePos?`: non-negative safe integer, default 0.
- `message?`: upstream-validated UTF-8 message, at most 4096 bytes.
- `ws`: `{ "sandbox": "1", "path": "/workspaces/1" }`, taken from an actual mount result. The full mount result, including an optional `image` field, is also accepted; upstream uses only `sandbox/path`.

## Public methods: 27

| Tool name (without `layerfs_`) | JSON arguments |
| --- | --- |
| `project_init` | `sourcePath` |
| `project_list_branches` | `pageSize?`, `pagePos?` |
| `fs_read` | `ref`, `path`, `startLine?`, `endLine?` |
| `fs_list` | `ref`, `path?`, `pageSize?`, `pagePos?` |
| `fs_stat` | `ref`, `path` |
| `fs_grep` | `ref`, `pattern`, `path?`, `pageSize?`, `pagePos?` |
| `fs_glob` | `ref`, `pattern`, `path?`, `pageSize?`, `pagePos?` |
| `fs_diff_files` | `leftRef`, `leftPath`, `rightRef`, `rightPath` |
| `fs_blame` | `ref`, `path`, `fromLine?` |
| `fs_write` | `branch`, `path`, `content`, `encoding?`, `message?` |
| `fs_edit` | `branch`, `path`, `oldText`, `newText`, `message?` |
| `fs_apply` | `branch`, `changes`, `message?` |
| `fs_mkdir` | `branch`, `path`, `message?` |
| `fs_rm` | `branch`, `path`, `message?` |
| `fs_cp` | `branch`, `from`, `to`, `message?` |
| `fs_mv` | `branch`, `from`, `to`, `message?` |
| `branch_fork` | `name`, `fromRef?` |
| `branch_list_commits` | `branch`, `pageSize?`, `pagePos?` |
| `branch_diff_commits` | `from`, `to`, `pageSize?`, `pagePos?`, `cursor?`, `hunks?` |
| `branch_diff_branches` | `from`, `to`, `pageSize?`, `pagePos?`, `cursor?`, `hunks?` |
| `branch_merge` | `a`, `b`, `name`, `message?`, `units?` |
| `branch_publish` | `branch`, `commit?` |
| `workspace_mount` | `branch`, `image?` |
| `workspace_exec` | `ws`, `command`, `message?` |
| `workspace_status` | `ws` |
| `workspace_commit` | `ws`, `message?`, `force?` |
| `workspace_unmount` | `ws`, `discard?` |

`encoding` is `utf8` (default) or `base64`. Base64 must be standard encoding with correct padding. UTF-8 is passed to the SDK as-is; base64 becomes a Node Buffer. Native Node writable sinks are not JSON values, so MCP exec uses the upstream text output mode and returns the full stdout/stderr. No network-transmissible writable object is faked.

`fs.apply.changes` is an ordered array of these objects:

```json
[
  { "op": "mkdir", "path": "/src" },
  { "op": "write", "path": "/src/a.txt", "content": "hello\n" },
  { "op": "edit", "path": "/src/a.txt", "oldText": "hello", "newText": "world" },
  { "op": "cp", "from": "/src/a.txt", "to": "/src/copy.txt" },
  { "op": "mv", "from": "/src/copy.txt", "to": "/src/moved.txt" },
  { "op": "rm", "path": "/src/moved.txt" },
  { "op": "write", "path": "/src/binary", "content": "AP8=", "encoding": "base64" }
]
```

`branch_merge.units` is either a path pattern string or an array of `{ "name": "ui", "patterns": ["/ui/**"] }`. `.lww` configuration files are edited with the ordinary file tools; interpreting and validating them belongs to upstream.

## Operator methods: 13

Enabled by default; disable with `--no-operator`. They come from the upstream `@layerfs/sdk/operator` entry point and bypass the public method dispatch.

| Tool name (without `layerfs_operator_`) | JSON arguments |
| --- | --- |
| `store_stats` | none |
| `store_commits` | `branch`, `pageSize?`, `pagePos?` |
| `store_overwritten` | `layer`, `pageSize?`, `pagePos?` |
| `files_stats` | `ref`, `path` |
| `files_history` | `ref`, `path`, `pageSize?`, `pagePos?` |
| `workspace_overlay` | `ws` |
| `workspace_changes` | `ws`, `pageSize?`, `pagePos?` |
| `inspect_snapshot` | `since?` |
| `sandbox_list` | none |
| `project_progress` | none |
| `process_start` | `ws`, `command` |
| `process_list` | none |
| `process_cancel` | `process` |

`inspect_snapshot.since` takes the `version` from the previous result. `project_progress` shares the service process with Init, so other HTTP requests can read it during initialization. Keep the `process` ID returned by a background start and pass it unchanged to cancel.

## Bridge state, resources and prompts

- `layerfs_status({})`: when the runtime is `ready`, it reports the project, platform, missing configuration, native file presence, whether the SDK is loaded, the pinned upstream version and the currently enabled methods. Before `ready`, managed mode returns only the server name, project, backend, pinned upstream version, `runtimeState`, `stage` and a note. It does not open the store or start a sandbox. The CLI `status` and `doctor` commands run the same check and also leave the store closed. Passing configuration checks is not proof that Docker, FUSE and the store have been exercised.
- `layerfs://guide`: how the service works and how errors behave.
- `layerfs://capabilities`: the method map actually enabled under the current configuration.
- `layerfs://branches`: the first page of branches; continue paging with the list_branches tool.
- The `layerfs_workflow` prompt takes `task` and `branch?` and produces a branch-isolation, checkpoint, merge and publish workflow. Read-only mode does not offer the mutating workflow prompt.

## Pagination and interpreting results

Continue `items/hasMore` with `pagePos + items.length`. Both branch diffs also support `nextCursor → cursor`, which is the recommended way to page. Reads use 1-based inclusive line numbers and preserve `nextLine/truncated/lineTruncated`. When a single line exceeds the upstream line window, the omitted part cannot be recovered through later line windows; mount the workspace and read it with a command instead.

Commit history items use `id`. A publish that creates a Layer reports `publishedLayer.id`; other result shapes such as `UpToDate` should be read from the actual `kind`. Do not assume every success creates a checkpoint. All upstream result fields, nulls and diagnostic omission markers are preserved.

## Concurrency and lifecycle

Each agent gets its own branch and workspace. Operations on one workspace are sequential. The service never treats a timeout as a rollback, never retries, and never discards workspaces when a connection closes; native process lifetimes remain under LayerFS. Shutdown only calls upstream `close()` to release the store client. HTTP is sessionless Streamable HTTP; multiple authorized clients share one project and store.
