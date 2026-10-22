# MCP API

**中文** · [English](en/API.md) · [文档索引](README.md)

全部 41 个工具、3 个资源与 1 个工作流提示词的参考。工作流层面的约定见 [工作方式](HOW-IT-WORKS.md)。

工具名将上游方法的 `.` 替换为 `_` 并添加 `layerfs_` 前缀。例如 `fs.read` 对应 `layerfs_fs_read`。每个工具是独立的标准 MCP tool，参数为 JSON 对象；没有通用任意方法执行入口。一个 MCP 服务实例绑定一个项目。

所有工具成功时返回 `{ "result": <上游值> }`，同时存在于 `structuredContent` 和文本 content。失败时返回 `isError: true` 与 `{ "error": { "code", "message", "detail" } }`。MCP SDK 拒绝的无效参数也会返回工具错误，此时错误可能仅有文本 content。

通用参数：

- `ref`：`main`、分支名、commit ID 或 layer ID；写操作使用 `branch`。
- `path`、`from`、`to`：LayerFS 视图内绝对路径；`project.init.sourcePath` 是 MCP 服务主机上的绝对路径。
- `pageSize?`：1–1000，默认 50；`pagePos?`：非负安全整数，默认 0。
- `message?`：上游验证的 UTF-8 消息，最多 4096 字节。
- `ws`：`{ "sandbox": "1", "path": "/workspaces/1" }`，来自 mount 的实际结果。也可直接传入包含可选 `image` 字段的完整 mount 结果；上游只使用 `sandbox/path`。

## 公开方法：27

| 工具名（省略 `layerfs_`） | JSON 参数 |
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

`encoding` 为 `utf8`（默认）或 `base64`。base64 必须是包含正确 padding 的标准编码。UTF-8 原样传给 SDK，base64 转为 Node Buffer。原生 Node Writable sinks 不是 JSON 值；MCP exec 使用上游文本输出模式，返回完整 stdout/stderr。不会伪造网络可传递的 Writable 对象。

`fs.apply.changes` 是有序数组，每项为下列对象之一：

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

`branch_merge.units` 可为路径模式字符串或 `{ "name": "ui", "patterns": ["/ui/**"] }` 的数组。`.lww` 配置文件通过普通文件工具编辑，其解释与验证归上游。

## Operator 方法：13

默认启用，可通过 `--no-operator` 关闭。它们来自上游独立的 `@layerfs/sdk/operator` 入口，不经过公开方法 dispatch。

| 工具名（省略 `layerfs_operator_`） | JSON 参数 |
| --- | --- |
| `store_stats` | 无 |
| `store_commits` | `branch`, `pageSize?`, `pagePos?` |
| `store_overwritten` | `layer`, `pageSize?`, `pagePos?` |
| `files_stats` | `ref`, `path` |
| `files_history` | `ref`, `path`, `pageSize?`, `pagePos?` |
| `workspace_overlay` | `ws` |
| `workspace_changes` | `ws`, `pageSize?`, `pagePos?` |
| `inspect_snapshot` | `since?` |
| `sandbox_list` | 无 |
| `project_progress` | 无 |
| `process_start` | `ws`, `command` |
| `process_list` | 无 |
| `process_cancel` | `process` |

`inspect_snapshot.since` 接收上一结果的 `version`。`project_progress` 与 Init 使用同一服务进程，初始化期间其他 HTTP 请求可读取它。后台任务返回的 `process` ID 应原样保留给 cancel。

## 桥接层状态、资源和提示词

- `layerfs_status({})`：项目、平台、配置缺项、native 文件存在性、SDK 是否已加载、固定上游版本、当前启用的方法。它不会打开 Store 或启动 Sandbox。`doctor` CLI 额外尝试加载 native addon，但不打开 Store。配置检查通过不代表 Docker、FUSE、Store 均已运行验证。
- `layerfs://guide`：工作方式与错误处理说明。
- `layerfs://capabilities`：当前配置下实际启用的方法映射。
- `layerfs://branches`：分支的第一页；用 list_branches 工具继续分页。
- `layerfs_workflow` 提示词：`task`、`branch?`，生成分支隔离、检查点、合并和发布的工作流。只读模式不提供修改工作流提示词。

## 分页和结果解释

`items/hasMore` 使用 `pagePos + items.length` 继续。两个 branch diff 还支持 `nextCursor → cursor`，推荐按 cursor 翻页。读取使用从 1 开始、包含端点的行号，并保留 `nextLine/truncated/lineTruncated`。遇到一行超过上游行窗口时，省略部分无法通过后续行窗口恢复；可挂载后通过命令读取。

commit history 项使用 `id`。publish 新建 Layer 的结果使用 `publishedLayer.id`；`UpToDate` 等其他结果形态以实际 `kind` 为准。不要假定所有成功返回都创建了新检查点。所有上游结果字段、空值和诊断省略标记均予以保留。

## 并发与生命周期

每个 Agent 建立自己的分支与 Workspace。同一 Workspace 上按顺序操作。服务不把 timeout 视作撤销，不自动重试，不在连接关闭时丢弃工作区；原生进程生命周期仍由 LayerFS 管理。服务关闭仅调用上游 `close()` 释放 Store 客户端。HTTP 使用无 session 的 Streamable HTTP；多个已授权客户端共享同一项目和 Store。
