# 故障排查

**中文** · [English](en/TROUBLESHOOTING.md) · [文档索引](README.md)

先跑这两条。项目已配置时，它们打印后端、运行环境状态和配置缺项；项目还没创建时只打印项目名和 `state: not-configured`。检查发现缺项时命令以非零状态退出。

```sh
layerfs-mcp status --project <name>
layerfs-mcp doctor --project <name>
```

## 启动与状态

**一直停在 `preparing`。** 首次启动要在后台构建镜像并创建运行环境，冷启动会下载基础镜像和 Rust 依赖。看服务 stderr（构建输出只写 stderr，stdout 留给 MCP）。多个 Agent 同时首次启动时，镜像构建和运行环境创建通过进程间锁串行执行，第二个客户端会等第一个完成。

**`runtimeState=failed`。** 这个字段来自 MCP 工具 `layerfs_status`。状态里带有具体错误。修复环境后重新连接；服务不会自动重试失败的 SDK 操作。

**调用直接返回 `RuntimePreparing`。** 运行环境还没就绪。这个错误不会排队、不会稍后偷偷执行，等 `ready` 后重新发起同一操作。

**`status` 通过但工具调用失败。** `status` 与 `doctor` 走同一项检查：读取项目配置、报告运行环境状态和缺项，不打开 Store、不启动 Sandbox。配置检查通过 ≠ Docker、FUSE、Store 已实际运行验证。

## 导入

**`init` 返回 `Exists`。** 该项目已初始化过。上游没有原地 reset 或项目删除 API；要重新导入就新建项目。

**导入的不是我想要的目录。** `serve` / `setup` 都不会自动导入，也不会把 Agent 的工作目录当成导入目录。首次创建项目时用 `--source /absolute/path` 只读挂载到 `/source`，再执行 `init`。已有项目的 source 属于已保存配置，改动会被明确拒绝。

**没有指定 source 却出现了文件。** `init` 在无 source 时导入包内示例 seed（`/example-seed`）。

## 引擎与平台

**macOS 图形客户端报找不到 `node` 或 `container`。** 用绝对路径，并设置 `LAYERFS_CONTAINER_BIN=/usr/local/bin/container`（或 `LAYERFS_DOCKER_BIN`）。

**Docker 后端挂载 Workspace 失败。** 需要 Docker 的 Linux 内核提供 `/dev/fuse`。没有 FUSE 时只能使用不挂载 Workspace 的读取/写入能力。

**原生模式报 Store 不受支持。** 原生 Store 只支持与 daemon 共享同一 Linux 内核的 ext4 / xfs / btrfs。用 Docker 时 Store 必须位于 Sandbox 使用的同一命名卷内。不要把 Store 放在 macOS bind mount、NFS 或 SMB 上。macOS 请改用 Apple 后端。

**换了 `--backend` 后像是丢了数据。** 同一个项目名不能迁移 Store。换后端请新建项目。

**已保存的镜像 / source / 资源参数被拒绝。** 这是故意的漂移保护。确实要改写配置时用 `layerfs-mcp update --project <name>`：它只重写配置文件，不重跑 setup、不删卷。

## 客户端接入

**远程客户端只能用 OAuth 登录。** 本服务不实现 OAuth 授权服务器，也不提供旧版 HTTP+SSE。让该客户端通过本地 stdio 模式接入，或放在能注入 Bearer 头的代理后面。

**HTTP 连接被拒。** 非 loopback 绑定必须设置 `LAYERFS_MCP_TOKEN`；反向代理必须正确传递 `Host` / `Origin`；默认只把端口发布到本机。

**多个客户端互相干扰。** 它们共享同一项目和 Store。请让每个 Agent 使用自己的分支与 Workspace；同一 Workspace 上的操作必须按顺序。

## 运行中

**命令超时了，操作到底有没有生效？** 服务不把 timeout 视作撤销，也不自动重试。先检查进程、工作区和提交历史，再决定重试或取消。

**卸载 Workspace 被拒绝。** 脏工作区默认拒绝卸载。先检查并提交；确实要丢弃未提交内容时显式传 `discard=true`。

**后台进程还在跑。** 服务退出不会取消后台进程。用 operator process 方法查看并取消。

**停止服务后数据还在吗？** `stop` 保留数据卷，再次 `serve` 会启动同一环境。但上游 Disposable Store 没有崩溃或断电持久性保证，重要数据请保留可重建的原始副本。

**Apple `stop` 之后 Sandbox 没了。** Apple 后端停止整个项目 VM，会终止其中的 Sandbox 和后台进程；停止前应先提交 Workspace。

## 排完还是不行

- 打开 [测试与验证](TESTING.md) 里的对应测试，用临时项目和临时卷复现问题。
- `npm run test:managed` 能判断问题出在 CLI 生命周期还是具体工具调用。
- Apple 和 Docker 的诊断工具（`layerfs_operator_store_stats`、`files_stats`、`workspace_overlay`、`inspect_snapshot`、`project_progress`）能区分是导入、覆盖层还是 Store 层的问题。
