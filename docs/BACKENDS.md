# 后端与部署

**中文** · [English](en/BACKENDS.md) · [文档索引](README.md)

同一个 MCP 接口有三种运行方式。日常推荐前两种，统一由 `layerfs-mcp serve --backend ...` 驱动。

| 后端 | 适用平台 | Store 位置 | 是否需要 Docker |
| --- | --- | --- | --- |
| `apple-container` | macOS（Apple Silicon 已实测） | 项目 VM 内的 ext4 命名卷 | 不需要 |
| `docker` | Linux、macOS 上的 Docker Desktop、Windows 上的 Linux 容器 | Docker 命名卷 | 需要 |
| `native` | Linux 主机，已有自建 LayerFS 部署 | 本地 ext4 / xfs / btrfs | 不需要 MCP 管理，需自备 |

三种后端对 Agent 暴露同一套工具与参数；差别只在运行环境、Store 位置和生命周期由谁管理。

## Apple Container（macOS 推荐）

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
layerfs-mcp init --project website
layerfs-mcp status --project website
```

Mac 只需要 Node.js 22+、npm 和运行中的 Apple Container 服务。一个项目一个 Linux VM，VM 内用 Podman/crun 承载全部 Workspace，共享同一 Store。架构、权限模型、自定义镜像与兼容范围见 [Apple Container 后端](APPLE-CONTAINER.md)。

## Docker（托管模式）

```sh
layerfs-mcp serve --backend docker --project website --source /absolute/path/website
layerfs-mcp init --project website
```

适合已经有 Docker 的 Linux 主机和 Docker Desktop。托管模式会自动准备 MCP 控制容器、镜像与卷；Sandbox 与后台进程由 LayerFS 自己管理。

## Docker Compose（手动部署）

想直接看容器、自己控制卷和端口时使用。要求 Node.js 22+、npm、运行中的 Docker Engine / Desktop，且内核提供 `/dev/fuse`（完整 Workspace 必需）。

```sh
npm ci
npm test
docker build -t layerfs-mcp:local .
npm run docker:configure
```

`docker:configure` 创建权限 0600 的 `.env`，写入随机 Bearer token 和本地镜像的不可变 ID，并拒绝覆盖已有文件。也可以手动复制 `.env.example` 填写。冷构建需要下载基础镜像和 Rust 依赖。

macOS / Docker Desktop：

```sh
docker compose up -d --no-build
```

Linux（host 网络接入发布在 Docker 主机 loopback 上的 daemon 端口）：

```sh
docker compose -f compose.yaml -f compose.linux.yaml up -d --no-build
```

HTTP 端点为 `http://127.0.0.1:8787/mcp`，请求头 `Authorization: Bearer <.env 中的 LAYERFS_MCP_TOKEN>`，默认只发布到本机。

首次使用时显式导入示例项目并检查连接：

```sh
node examples/client.mjs --init /source
node examples/client.mjs
```

`/source` 是服务容器内目录，由 Compose 把 `LAYERFS_SOURCE_DIR` 只读挂载进去。要导入真实项目，应在首次初始化前修改 `.env` 中的该路径并重启服务。启动服务不会自动初始化或覆盖项目；对已有项目再次初始化返回上游 `Exists`。

### stdio 客户端

把 [examples/mcp-stdio.json](../examples/mcp-stdio.json) 里的路径换成此仓库的绝对路径：

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "docker",
      "args": [
        "compose", "--project-directory", "/absolute/path/LayerFS-MCP",
        "run", "--rm", "--no-deps", "-T",
        "layerfs-mcp", "--transport", "stdio"
      ]
    }
  }
}
```

Linux 在 `run` 之前追加 `-f /absolute/path/LayerFS-MCP/compose.yaml -f /absolute/path/LayerFS-MCP/compose.linux.yaml`。每个客户端可以启动自己的 MCP 进程，它们通过相同的命名卷共享项目历史，不需要同时运行 HTTP 服务。项目初始化后可运行 `node examples/stdio-client.mjs` 验证这条链路。

### HTTP 客户端

[examples/mcp-http.json](../examples/mcp-http.json) 提供常见配置形态；需要代码示例时参考 [examples/client.mjs](../examples/client.mjs)。仅支持 OAuth 登录、不能设置自定义 Bearer 请求头的远程客户端，应改用其本地 stdio 模式。

## 原生 Linux 模式

用于已有自建 LayerFS 部署的 Linux 主机。SDK 尚未发布到 npm，需要先检出并编译固定上游：

```sh
git clone https://github.com/Ephemeral-AI-Lab/layerfs.git /absolute/path/layerfs
git -C /absolute/path/layerfs checkout 5fb68ddc1acc3163e3ac3486133bde014c5fbed3
cd /absolute/path/layerfs
cargo +1.85.1 fetch --manifest-path core/Cargo.toml --locked
npm --prefix sdk/js run build:native
cargo +1.85.1 build --manifest-path core/Cargo.toml --locked --release -p layerfs-daemon
```

按上游 [SDK 指南](https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/sdk/js/README.md) 配置 Store 和部署环境，然后：

```sh
cd /absolute/path/LayerFS-MCP
npm ci
npm run build
export LAYERFS_SDK_PATH=/absolute/path/layerfs
export LAYERFS_MCP_PROJECT=website
export LAYERFS_HOME=/absolute/private/layerfs-home
export LAYERFS_STORE_PATH=/absolute/local/store-volume/global/store.sqlite
# 完整 Workspace 还需 LAYERFS_IMAGE、LAYERFS_VOLUME、LAYERFS_DAEMON，见配置文档。
node dist/cli.js doctor
node dist/cli.js --transport stdio
```

原生 Store 只支持与 daemon 共享同一 Linux 内核的 ext4 / xfs / btrfs。用 Docker 时，Store 路径必须位于 Sandbox 使用的同一 Docker 命名卷内（位置可用 `docker volume inspect` 查得）。不要把 Store 放在 macOS bind mount、NFS 或 SMB 上。macOS 请用 Apple 后端；Windows 客户端连接 Linux 容器或 Linux 远程服务。

## 多项目与多 Agent

- 一个服务实例一个项目。要跑另一个项目，使用不同的项目名、home、Store 卷、容器前缀和端口；只改项目名而复用同一个 Store 文件不行。
- 多个 Agent 可以共享同一个项目，各自使用自己的分支与 Workspace。
- 旧的 `apple ...` 子命令和 Docker Compose 部署仍然可用，新部署推荐统一入口。
