# 统一 CLI 与 npm 分发

统一命令为 `layerfs-mcp <action> --backend apple-container|docker|native --project <name>`。`apple-container` 为推荐名称，`apple` 是兼容别名；已有项目配置和状态中的 `apple` 标识保持兼容。Apple 与 Docker 托管后端支持相同的 `serve`、`setup`、`init`、`status`、`doctor` 和 `stop`，以及 stdio / Streamable HTTP。

## 直接启动，不要求 setup

仓库开发时执行 `npm ci && npm run build`，然后 `npm link` 将 `layerfs-mcp` 加入 npm 的全局命令目录。已发布版本可直接通过 npm registry 启动：

```sh
npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website
bunx layerfs-mcp@0.1.0 serve --backend apple-container --project website
```

Docker 用户将 `--backend apple-container` 改为 `--backend docker`。后续启动可省略后端：

```sh
layerfs-mcp serve --project website
```

`serve` 自动保存项目配置、检查引擎、准备镜像、创建所需卷和运行环境。默认镜像不存在时，从 npm 包自带的源码、锁文件和 Dockerfile 构建固定版本的 LayerFS；无需检出本仓库。`--image` 指定自定义 runtime 镜像时，使用本地镜像或从指定 registry 拉取。默认镜像 tag 包含包版本；已有项目保持保存的镜像配置，不会因为 `npx` 更新包就隐式替换运行环境。

Mac 仍需安装 Apple Container；Docker 模式需可用的 Linux Docker Engine / Docker Desktop。两种模式都需 Node.js 22+。`npx` / `bunx` 负责获取和启动 MCP 包，首次镜像准备还需网络、磁盘空间与容器引擎。`bunx` 默认遵循包的 Node shebang，仍由 Node 运行；本项目不要求或测试 `bunx --bun` 强制切换运行时。

依据：[npm npx 文档](https://docs.npmjs.com/cli/v10/commands/npx/)、[Bun bunx 文档](https://github.com/oven-sh/bun/blob/main/docs/pm/bunx.mdx)。

## 冷启动与可选预热

MCP 在开始后台构建前即可握手并列出工具。`layerfs_status` 报告：

| runtimeState | 含义 |
| --- | --- |
| `preparing` | 等待项目锁、检查引擎、准备/构建镜像、启动运行环境或连接内部 MCP |
| `ready` | 可以调用 LayerFS 方法 |
| `failed` | 返回具体错误；修复环境后重新连接，不自动重复失败的 SDK 操作 |

准备期间调用 LayerFS 方法会立即返回 `RuntimePreparing`，不会排队、写入或在稍后偷偷执行。Agent 应检查状态，等到 `ready` 后重新发出操作。构建输出只写 stderr，stdout 始终保留给 MCP。

`setup` 仅用于提前准备，适合希望首次 Agent 接入立即可用的场景：

```sh
layerfs-mcp setup --backend apple-container --project website --source /absolute/path/website
```

多个 Agent 同时首次启动会共享持久化项目配置，镜像构建与运行环境创建通过进程间锁串行执行。npm 缓存不是项目状态的存放位置。

## 准备运行环境与导入项目是两件事

`serve` 和 `setup` 都不会自动导入文件。首次创建项目时用 `--source` 将目录只读挂载到 `/source`，再显式导入：

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
# 在另一终端执行，或由 Agent 调用 layerfs_project_init({sourcePath:"/source"})
layerfs-mcp init --project website
```

没有配置 source 时，`init` 导入包内的示例 seed；Agent 可用 `/example-seed` 作为导入源。已有项目再次初始化返回上游 `Exists`。不自动将 Agent 的工作目录当成导入目录。

## 配置和生命周期

配置保存在 `~/.config/layerfs-mcp/projects/<project>.json`，可用 `LAYERFS_MCP_CONFIG_DIR` 指定其他目录。首次选择优先级为 `--backend`、`LAYERFS_MCP_BACKEND`、已有项目配置、平台默认值（Mac 为 Apple，其他平台为 Docker）。配置了 `LAYERFS_SDK_PATH` 或 `--sdk-path` 时，未显式指定后端的命令使用原生 Linux 模式。

```sh
layerfs-mcp status --project website
layerfs-mcp doctor --project website
layerfs-mcp stop --project website
layerfs-mcp serve --project website --read-only
```

同一个项目名不能通过换 `--backend` 自动迁移 Store。已经保存的镜像、source、VM 名称和资源参数发生变化时会明确拒绝；使用新项目，或显式管理已有运行环境和配置。旧版手动创建的 Apple 项目可用匹配其镜像和资源的参数登记，例如原默认示例可用 `serve --backend apple-container --project default --image docker.io/library/layerfs-mcp-apple:local`。

`stop` 保留数据卷。Apple 停止整个项目 VM，会终止其 Sandbox/后台进程；Docker 停止项目的 MCP 控制容器，Sandbox/后台进程仍由 LayerFS 管理，需要时先使用相应 Workspace/process 工具提交、卸载或取消。再次 `serve` 会启动同一环境。客户端退出只关闭它自己的 MCP 连接。每个容器内 MCP 进程使用独立临时目录，防止重启后 PID 复用造成临时 Overlay 目录冲突。

原生模式使用已有 Linux SDK、Store 和容器执行器，`setup`/`stop` 不管理其外部基础设施。旧 `apple ...` 子命令和 Docker Compose 部署保留，但推荐新部署使用统一入口。

## MCP 客户端配置

发布后可使用：

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "npx",
      "args": ["-y", "layerfs-mcp@0.1.0", "serve", "--backend", "apple-container", "--project", "website"]
    }
  }
}
```

本地已安装/链接包时，改为 `command: "layerfs-mcp"`，args 从 `serve` 开始。Bun 用户可使用 `command: "bunx"`，args 从包名开始。图形客户端需要能在 PATH 中找到 Node 与所选容器 CLI；也可设置 `LAYERFS_CONTAINER_BIN` / `LAYERFS_DOCKER_BIN` 的绝对路径。

HTTP 使用同一个入口，服务监听在宿主机，内部仍通过 stdio 连接项目运行环境：

```sh
layerfs-mcp serve --backend apple-container --project website --transport http --host 127.0.0.1 --port 8787
```

HTTP 的 Bearer token、Host/Origin 检查和非 loopback 认证要求与原有服务一致。只读、隐藏 operator 和禁止执行参数对两种后端及两种传输均生效。

## 打包与验证

`npm pack` 包含可执行的 dist、完整镜像构建源码、`npm-shrinkwrap.json`、固定上游补丁与配置；既能运行 CLI，也能在没有仓库 checkout 的情况下构建 runtime。发布前可以用本地 tarball 验证：

```sh
npm pack
npx -y --package ./layerfs-mcp-0.1.0.tgz layerfs-mcp --help
bunx --package ./layerfs-mcp-0.1.0.tgz layerfs-mcp --help
npm run test:managed
# 验证另一个后端：
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

`test:managed` 不运行 setup，使用临时项目和官方 MCP Client 验证冷启动、并发客户端、全部 40 个方法、宿主机 HTTP 接入、配置复用与停止后接入，并清理该测试的运行环境和卷。npm 发布需要另外执行发布操作；打包成功不代表已经发布。
