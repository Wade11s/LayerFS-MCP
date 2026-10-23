# 快速上手

**中文** · [English](en/QUICKSTART.md) · [文档索引](README.md)

从零到第一次成功的 MCP 调用，约 5 分钟。

## 0. 前置条件

| 需要 | 说明 |
| --- | --- |
| Node.js 22+ | CLI 与 MCP SDK 的运行环境 |
| 容器引擎 | macOS：[Apple Container](https://github.com/apple/container)（先 `container system start`）；Linux / Windows：Docker Engine 或 Docker Desktop |
| 磁盘与网络 | 首次启动要构建固定版本的 runtime 镜像；离线环境可用 `--image` 指定已构建好的镜像 |

Docker 后端要求 Docker 的 Linux 内核提供 `/dev/fuse`，否则只能使用不挂载 Workspace 的读取/写入能力。Apple 后端不需要 Docker。

## 1. 安装

三种方式任选：

```sh
# 免安装
npx -y layerfs-mcp@0.1.0 --help
bunx --package layerfs-mcp@0.1.0 layerfs-mcp --help

# 全局安装
npm i -g layerfs-mcp@0.1.0

# 仓库内开发
npm ci && npm run build && npm link
```

`npx` / `bunx` 只负责获取和启动这个 MCP 包，不会替你安装容器引擎。

## 2. 启动服务

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
```

- `--backend`：`apple-container`（兼容名 `apple`）、`docker` 或 `native`。除首次外可省略，配置会保存到项目文件。
- `--project`：一个项目一套 Store、卷和容器前缀。默认 `default`。
- `--source`：只读挂载到运行环境内的 `/source`，供下一步导入；不指定则 `init` 导入包内示例 seed。

首次启动会在后台构建镜像并创建运行环境。MCP 握手、工具列表和 `layerfs_status` 立即可用；此时状态是 `preparing`，构建完成后变为 `ready`。准备期间的 LayerFS 调用会立即返回 `RuntimePreparing`，不会排队或稍后偷偷执行。

希望第一个 Agent 连上就可用，可以先预热一次：

```sh
layerfs-mcp setup --backend apple-container --project website --source /absolute/path/website
```

## 3. 导入项目

`serve` 和 `setup` 都不会导入文件。导入是显式写入操作：

```sh
layerfs-mcp init --project website
```

也可以让 Agent 调用 `layerfs_project_init({ "sourcePath": "/source" })`。没有配置 source 时，`init` 导入示例 seed（`/example-seed`）。对已有项目再次初始化会返回上游 `Exists`——它不会覆盖或合并。

## 4. 接入 Agent

stdio 配置（等价于 [examples/mcp-unified-stdio.json](../examples/mcp-unified-stdio.json)）：

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "layerfs-mcp",
      "args": ["serve", "--backend", "apple-container", "--project", "website"]
    }
  }
}
```

用 `npx` 启动时见 [examples/mcp-npx.json](../examples/mcp-npx.json)。图形客户端如果找不到 `node` 或容器 CLI，用绝对路径，或设置 `LAYERFS_CONTAINER_BIN` / `LAYERFS_DOCKER_BIN`。

HTTP 配置：

```sh
export LAYERFS_MCP_TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
layerfs-mcp serve --project website --transport http --host 127.0.0.1 --port 8787
```

端点 `http://127.0.0.1:8787/mcp`，请求头 `Authorization: Bearer $LAYERFS_MCP_TOKEN`，客户端配置见 [examples/mcp-http.json](../examples/mcp-http.json)。绑定非 loopback 地址时 token 必填。

## 5. 确认可用

```sh
layerfs-mcp status --project website   # 项目、后端、运行环境状态
layerfs-mcp doctor --project website   # 当前与 status 执行同一项检查
```

`status` 打印的 `state` 是运行环境状态，例如 `running`、`stopped`、`not-configured`。准备进度在 MCP 工具 `layerfs_status` 的 `runtimeState` 里，取值 `preparing`、`ready`、`failed`。

Agent 侧的第一次调用建议是 `layerfs_status`，然后 `layerfs_project_list_branches`——返回 `main` 说明 Store 已打开且导入成功。

想一次性验证协议、全部方法、并发客户端和重启行为：

```sh
npm run test:managed
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

## 6. 停止与恢复

```sh
layerfs-mcp stop --project website
```

`stop` 保留数据卷。再次 `serve` 会启动同一环境并读取原 Store。Apple 后端的 `stop` 会停止整个项目 VM，因此会终止其中的 Sandbox 和后台进程；停止前应先提交 Workspace。

## 下一步

- 让每个 Agent 走自己的分支和 Workspace：见 [工作方式](HOW-IT-WORKS.md)。
- 收紧工具集（只读、隐藏 operator、禁用命令执行）：见 [配置](CONFIGURATION.md)。
- 手动 Docker Compose 部署或原生 Linux 模式：见 [后端](BACKENDS.md)。
