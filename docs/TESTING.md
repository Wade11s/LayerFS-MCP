# 测试与验证

**中文** · [English](en/TESTING.md) · [文档索引](README.md)

## 测试入口

| 命令 | 覆盖范围 | 外部依赖 |
| --- | --- | --- |
| `npm test` | 协议、工具 schema、参数转换、分页与错误保留、策略限制、stdio 与 HTTP | 无（HTTP 测试需允许本机端口监听） |
| `npm run check` | `tsc --noEmit` | 无 |
| `npm run verify:upstream` | 与固定上游实际导出的方法集合比较 | 固定提交的 LayerFS checkout |
| `npm run test:docker` | 真实 native addon、Store、FUSE，调用全部 40 个上游方法 | Docker + `/dev/fuse` |
| `npm run test:apple` | Mac CLI → Apple VM → 官方 MCP Client，调用全部 40 个方法 | Apple Container |
| `npm run test:managed` | 统一 CLI：冷启动、并发客户端、全部方法、配置复用、重启 | 对应后端 |
| `npm run golden` | 上游结果重放 | 无 |

```sh
npm ci
npm run check
npm test
LAYERFS_SDK_PATH=/absolute/path/layerfs npm run verify:upstream

# 构建镜像后，使用独立临时卷真实调用全部 40 个上游方法
npm run test:docker

# macOS，先构建 apple-runtime 镜像
npm run test:apple

# 统一 CLI：不运行 setup，验证并发接入、全部方法和重启
npm run test:managed
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

隔离约定：

- `test:docker` 使用真实 native addon、Store 和 FUSE，结束后清理它自己创建的容器与卷；不会碰部署用的正式 Store。
- `test:apple` 创建临时项目 VM，结束后只清理它创建且通过归属检查的 VM 和卷。
- `test:managed` 使用随机临时项目，结束后删除对应运行环境和卷。
- `npm run test:real` 是给显式配置原生环境的底层入口，需要 `LAYERFS_REAL_TESTS=1` 才写入数据。

CI 见 [.github/workflows/ci.yml](../.github/workflows/ci.yml)：每个 push / PR 运行 `check`、`npm test` 和 `npm pack --dry-run`；原生与 Docker 用真实 Store 的检查只在手动 `workflow_dispatch` 时跑。

## 构建镜像时复用上游 checkout

构建镜像时若已有固定版本的上游 checkout，可以避免重复下载：

```sh
docker build --build-context layerfs=/absolute/path/layerfs -t layerfs-mcp:local .
```

传入的 checkout 必须是锁定提交；升级后先运行契约检查和真实测试。

## 本机验证记录

验证日期 2026-10-22，主机 macOS 27.0.1 arm64，分别验证 Docker Desktop 与 Apple Container 1.6.0 后端。上游固定为 `5fb68ddc1acc3163e3ac3486133bde014c5fbed3`（含 lock 文件记录的 Podman 兼容补丁），MCP SDK 为 `1.32.1`。

| 验证 | 结果 |
| --- | --- |
| TypeScript 编译 | 通过 |
| `npm test` | 19/19 通过（当日快照；仓库当前为 27 项，HTTP 测试需允许本机端口监听） |
| 与实际上游导出集合比较 | 27 个公开方法 + 13 个 operator 方法完全匹配 |
| Linux addon / daemon release 编译 | Rust 1.85.1 构建成功 |
| 原生兼容补丁检查 | `layerfs-sandbox` 28 项外部测试、rustfmt、Clippy `-D warnings` 通过 |
| `npm run test:docker` | 真实调用全部 40 个方法通过，未跳过 Workspace |
| Apple 独立构建 | `container build --target apple-runtime` 成功，无 Docker socket |
| Mac CLI → Apple VM → MCP | 官方 MCP Client 发现 41 个工具，真实调用全部 40 个方法通过 |
| Apple 多客户端 | 第二个独立 stdio 客户端读取同一 Store 中已提交的命令输出 |
| Apple 执行身份 | UID 501、有效 capability 为零、创建用户 namespace 被拒绝 |
| Apple 默认启动与重启 | 固定 digest 的默认 Sandbox 镜像下载、显式 seed 导入、VM stop 后 CLI 自动 start 并读取原 Store 通过 |
| FUSE 和命令执行 | 挂载、exec、状态、commit、unmount 通过 |
| 后台进程 | start、list、cancel 通过 |
| 分支和存储 | 导入、原子批量修改、历史、差异、合并、发布、冲突和诊断通过 |
| HTTP 协议 | 官方 MCP Client、并发客户端、Bearer、Host/Origin、无效 JSON 检查通过 |
| Compose HTTP 示例 | 初始化随仓库提供的 seed，发现 41 个工具，配置无缺项 |
| Compose stdio 示例 | 独立进程发现 41 个工具，并读取 HTTP 服务初始化的同一项目 |
| 统一 CLI：Docker | 无手动 setup，全部 40 个方法、并发客户端、配置复用、停止后重新读取通过 |
| npm tarball → npx → Apple | 包内源码自动构建 runtime 通过；全部 40 个方法、并发客户端与重启通过 |
| npm tarball → bunx → Docker | 自动构建默认 runtime 镜像，全部 40 个方法、并发客户端与重启通过 |
| 托管 Apple / Docker HTTP | 宿主机统一 CLI 监听 HTTP，官方 MCP Client 通过 Bearer 认证并读取同一项目通过 |
| CLI 临时目录回归 | 每个进程独立目录、权限、退出清理与参数解析通过；Docker 重启后 PID 复用不会导致 Overlay 目录冲突 |
| 发布版本检查 | 已发布版本跳过、新稳定版本放行、拒绝回退与预发布版本、区分首次包缺失及 registry 错误通过；远端发布尚未执行 |
| 后端名称兼容 | `apple-container` 成功复用已有 `apple` 配置和运行中的示例项目 |
| npm 打包与本机命令 | 包含镜像构建源码和 shrinkwrap；本机已 `npm link`；未执行发布 |
| Compose Linux override 配置解析 | 通过；本次实际运行使用 Docker Desktop 网络 |

环境说明：

- 本机示例服务由 `docker compose` 运行在 `http://127.0.0.1:8787/mcp`，项目 `default`，凭据在未纳入 Git 的 `.env`。仅导入 `examples/seed`，未导入用户业务数据。用 `docker compose stop` 停止，`docker compose up -d --no-build` 恢复。除非确实要清除示例数据，不要删卷。
- 另有独立的 Apple 示例项目 `default`，VM 为 `lfm-default-37a8eec1`，只导入同一份 seed，与 Docker 示例数据互不共享。已登记到统一 CLI：`layerfs-mcp serve --project default`，`layerfs-mcp stop --project default` 停止 VM 并保留 ext4 卷。旧 `apple ...` 子命令仍可用，`node examples/apple-client.mjs` 可检查。VM 内为 Podman 4.3.1、crun 1.8.1、Linux 6.18.35，Mac 端不需要 Docker Engine。
- 统一 CLI 测试使用随机临时项目，测试后删除对应运行环境和卷；覆盖原生 Store、FUSE、分支合并、提交发布、日志与后台进程。

## 验证边界

这里验证的是官方 MCP 客户端与固定提交上游的 API 互操作，**没有**逐个测试所有第三方 Agent 产品。原生 Linux 独立主机和 Windows 客户端未在上述环境中实际运行。GitHub Actions 工作流已提供，本地验证不代表远端 CI 已运行。架构和兼容条件见 [Apple Container 后端](APPLE-CONTAINER.md)。
