# 工作方式

**中文** · [English](en/HOW-IT-WORKS.md) · [文档索引](README.md)

## 固定上游与完整性

- 固定上游提交：[`5fb68ddc1acc3163e3ac3486133bde014c5fbed3`](https://github.com/Ephemeral-AI-Lab/layerfs/tree/5fb68ddc1acc3163e3ac3486133bde014c5fbed3)，记录在 [upstream.lock.json](../upstream.lock.json)。
- 该提交已用 `workspace.*` 管理工作区，公开方法实际为 27 个。上游 README 里的「29 方法」来自旧的 `sandbox.*` 契约。
- 所有功能调用真实上游 SDK。存储格式、去重、检查点、`.lww` 冲突规则和合并算法都由 LayerFS 实现，本项目不含模拟存储后端。
- `npm run verify:upstream` 比较实际导出的方法集合；升级上游时新增或缺失的方法都会让检查失败。
- 原生构建额外应用仓库记录的 [Podman 兼容补丁](../patches/apple-container-podman.patch)，仅在 Apple 后端显式启用；校验和记录在 lock 文件中。

## 典型工作流

1. **看状态**：`layerfs_status` 检查配置；托管模式等到 `runtimeState=ready`。
2. **导入项目**：`layerfs_project_init({ "sourcePath": "/source" })`。导入是显式写入，`serve` 不会代做。
3. **分叉**：`layerfs_branch_fork` 为每个 Agent 建立分支。`main` 只通过 publish 更新。
4. **改文件**：`fs` 写入自动生成检查点；`fs.apply` 在一个检查点中原子应用有序修改。
5. **跑命令**：`workspace_mount → workspace_exec → workspace_commit → workspace_unmount`。保存 mount 返回的 `{sandbox,path}`，同一 Workspace 上的操作按顺序进行。
6. **合并与发布**：用 merge 合并分支，再按任务要求 publish。

几个容易踩的点：

- 命令失败也可能已经修改了文件。先检查、提交，再卸载；脏工作区默认拒绝卸载，只有显式 `discard=true` 才丢弃未提交内容。
- 服务退出不会擅自卸载工作区，也不会取消后台进程。
- 回到旧状态用旧 commit / layer 作为 `fork.fromRef`；上游没有原地 reset、项目删除或 GC 的公共 API。
- 需要取消后台任务时用 operator process 方法，不要指望连接关闭。

## 返回结构与错误

成功时返回 `{ "result": <上游值> }`，同时出现在 `structuredContent` 和文本 content 中。失败时 `isError=true`，并保留 `code / message / detail`。

桥接层不静默裁剪：分页信息、冲突省略标记、`null` 指标和完整命令输出都原样保留。二进制写入用 `encoding: "base64"`；`fs.read` 只读文本，二进制内容可通过 Workspace 命令处理。

参数、语义和每个工具的具体字段见 [MCP API](API.md)。

## 并发与生命周期

- 每个 Agent 使用自己的分支和 Workspace；同一 Workspace 上按顺序操作。
- 服务不把客户端 timeout 视作撤销，也不自动重试。`Unknown`、超时或断线都不表示操作没有发生，也不保证原生命令已经停止。
- 服务关闭只调用上游 `close()` 释放 Store 客户端，不会丢弃工作区。
- HTTP 使用无 session 的 Streamable HTTP；多个已授权客户端共享同一项目和 Store。

## 持久性边界

上游 **Disposable Store 没有崩溃或断电持久性保证**。它适合承载可重建的中间状态，不适合当作唯一副本。MCP 层不改变这一性质，也不会替你备份：请保留可重建数据的原始副本。

## 安全边界

默认完整模式具备目录导入、命令执行和 Docker 权限；这些能力按设计提供给 Agent，因此只应连接可信 Agent。分支与 Workspace 是工作隔离手段，不是租户权限边界。需要收紧时用 `--read-only`、`--no-operator`、`--disable-exec`，见 [配置](CONFIGURATION.md)。
