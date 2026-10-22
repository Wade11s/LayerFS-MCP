# 本地验证记录

验证日期：2026-10-22。主机为 macOS 27.0.1 arm64；分别验证 Docker Desktop 和 Apple Container 1.6.0 后端。上游固定为 `5fb68ddc1acc3163e3ac3486133bde014c5fbed3`，包含 lock 文件记录的 Podman 兼容补丁，MCP SDK 为 `1.32.1`。

| 验证 | 结果 |
| --- | --- |
| TypeScript 编译 | 通过 |
| `npm test` | 19/19 通过（HTTP 测试需允许本机端口监听） |
| 与实际上游导出集合比较 | 27 个公开方法 + 13 个 operator 方法完全匹配 |
| Linux addon / daemon release 编译 | Rust 1.85.1 构建成功 |
| 原生兼容补丁检查 | `layerfs-sandbox` 28 项外部测试、rustfmt、Clippy `-D warnings` 通过 |
| `npm run test:docker` | 真实调用全部 40 个方法通过，未跳过 Workspace |
| Apple 独立构建 | 使用 `container build --target apple-runtime` 成功构建，无 Docker socket |
| Mac CLI → Apple VM → MCP | 官方 MCP Client 发现 41 个工具，真实调用全部 40 个方法通过，未跳过 Workspace |
| Apple 多客户端 | 第二个独立 stdio 客户端读取同一 Store 中已提交的命令输出 |
| Apple 执行身份 | UID 501、有效 capability 为零、创建用户 namespace 被拒绝 |
| Apple 默认启动与重启 | 固定 digest 的默认 Sandbox 镜像下载、显式 seed 导入、VM stop 后 CLI 自动 start 并读取原 Store 通过 |
| FUSE 和命令执行 | 挂载、exec、状态、commit、unmount 通过 |
| 后台进程 | start、list、cancel 通过 |
| 分支和存储 | 导入、原子批量修改、历史、差异、合并、发布、冲突和诊断通过 |
| HTTP 协议 | 官方 MCP Client、并发客户端、Bearer、Host/Origin、无效 JSON 检查通过 |
| Compose HTTP 示例 | 初始化随仓库提供的 seed；发现 41 个工具，配置无缺项 |
| Compose stdio 示例 | 独立进程发现 41 个工具，并读取 HTTP 服务初始化的同一项目 |
| 统一 CLI：Docker | 无手动 setup，全部 40 个方法、并发客户端、配置复用、停止后重新读取通过 |
| npm tarball → npx → Apple | 包内源码自动构建 runtime 通过；最终 CLI 的全部 40 个方法、并发客户端与重启通过 |
| npm tarball → bunx → Docker | 自动构建默认 runtime 镜像，全部 40 个方法、并发客户端与重启通过 |
| 托管 Apple / Docker HTTP | 宿主机统一 CLI 监听 HTTP，官方 MCP Client 通过 Bearer 认证并读取同一项目通过 |
| CLI 临时目录回归 | 每个进程独立目录、权限、退出清理与参数解析通过；Docker 重启后 PID 复用不会导致 Overlay 目录冲突 |
| 发布版本检查 | 已发布版本跳过、新稳定版本放行、拒绝回退与预发布版本、区分首次包缺失及 registry 错误通过；远端发布尚未执行 |
| 后端名称兼容 | apple-container 成功复用已有 apple 配置和运行中的示例项目 |
| npm 打包与本机命令 | 包含镜像构建源码和 shrinkwrap；本机已 npm link，layerfs-mcp 可用；未执行发布 |
| Compose Linux override 配置解析 | 通过；本次实际运行使用 Docker Desktop 网络 |

当前本地示例服务由 `docker compose` 运行，地址为 `http://127.0.0.1:8787/mcp`，项目为 `default`。凭据位于未纳入 Git 的 `.env`。仅导入 `examples/seed`，未导入用户业务数据。使用 `docker compose stop` 停止服务；再次 `docker compose up -d --no-build` 可启动。请勿删除卷，除非确实要清除示例项目数据。

另有独立的 Apple 示例项目 `default`，VM 为 `lfm-default-37a8eec1`，仅导入同一 seed；它与 Docker 示例的数据互不共享。已按原镜像参数登记到统一 CLI，使用 `layerfs-mcp serve --project default` 接入，`layerfs-mcp stop --project default` 停止 VM 并保留 ext4 卷。旧 `apple ...` 子命令仍可用。`node examples/apple-client.mjs` 可检查。VM 内使用 Podman 4.3.1、crun 1.8.1、Linux 6.18.35；Mac 不需要 Docker Engine。

Apple 和 Docker 统一 CLI 测试使用随机临时项目，测试后已删除对应运行环境和卷；覆盖原生 Store、FUSE、分支合并、提交发布、日志与后台进程。具体架构和兼容条件见 [Apple Container 文档](APPLE-CONTAINER.md)。

这里验证的是官方 MCP 客户端互操作与固定提交的上游 API；没有宣称逐个测试所有第三方 Agent 产品。原生 Linux 独立主机和 Windows 客户端未在本次环境中实际运行。GitHub Actions 工作流已提供，本地验证不代表远端 CI 已运行。
