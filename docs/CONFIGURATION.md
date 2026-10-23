# 配置

**中文** · [English](en/CONFIGURATION.md) · [文档索引](README.md)

配置分三层：CLI 参数、环境变量、已保存的项目配置。优先级见文末。

## 项目配置

保存位置：`LAYERFS_MCP_CONFIG_DIR`，默认 `~/.config/layerfs-mcp`。每个项目一个文件：

```text
~/.config/layerfs-mcp/projects/<project>.json
```

`serve`、`setup`、`init`、`status`、`doctor`、`stop` 读写同一份配置。首次选择后端的优先级是 `--backend`、`LAYERFS_MCP_BACKEND`、已有项目配置、平台默认值（macOS 为 Apple Container，其他平台为 Docker）。

已保存的镜像、source、VM 名称和资源参数发生变化时，命令会明确拒绝，而不是隐式替换。需要显式改写配置时：

```sh
layerfs-mcp update --project website --image docker.io/library/layerfs-mcp-apple:local
```

`update` 只重写配置文件，不重跑 setup、不删除卷；后端自己的漂移检查仍会在下次 `serve` / `setup` 时生效。旧版手动创建的 Apple 项目可以用匹配其镜像和资源的参数登记后继续使用。

同一个项目名不能通过换 `--backend` 迁移 Store。需要另一套运行环境时新建项目。

## 环境变量

### 运行环境与 Store

| 变量 | 含义 |
| --- | --- |
| `LAYERFS_SDK_PATH` | 固定版本的 LayerFS checkout 或其 `sdk/js` 目录；Docker 镜像已设置 |
| `LAYERFS_MCP_BACKEND` | `apple`、`docker` 或 `native`；优先使用 CLI 显式选择 |
| `LAYERFS_MCP_CONFIG_DIR` | 托管项目配置目录，默认 `~/.config/layerfs-mcp` |
| `LAYERFS_MCP_PROJECT` | 当前项目名，默认 `default` |
| `LAYERFS_STORE_PATH` | Linux 本地 Store 路径；容器中为 `/layerfs-store/global/store.sqlite` |
| `LAYERFS_NATIVE` | 可选 native addon 路径，默认由上游 SDK 选择 |
| `LAYERFS_IMAGE` | 已存在于本地 Docker Engine 的不可变 `sha256:...` 镜像 ID |
| `LAYERFS_VOLUME` | Sandbox 与 MCP 共同使用的现有本地命名卷 |
| `LAYERFS_DAEMON` | MCP 进程可读取的 Linux daemon 文件；SDK 会将其传入 Sandbox |
| `LAYERFS_ENGINE` | 默认 `docker`；Apple runtime 自动设置 `podman` 并配置 VM 内兼容 socket |
| `LAYERFS_MCP_STORE_POLICY` | 可选 JSON：`smallFileThreshold`、`wholeFileDepth`、`chunkDepth`、`metadataDepth`，仅在 Init 时写入 Store |
| `LAYERFS_TRACE`, `LAYERFS_TRACE_STEP`, `LAYERFS_TRACE_START` | 上游调用追踪配置，原样传递 |

以下几项由部署写入运行环境，供 VM 或容器内的上游 SDK 与适配器读取。在宿主机 MCP 进程的环境里设置它们不会改变运行环境的取值。

| 变量 | 谁写入 | 谁读取 |
| --- | --- | --- |
| `LAYERFS_HOME` | `Dockerfile`、`apple/boot.mjs` | `docker/entrypoint.mjs` 与运行环境内的上游 SDK |
| `LAYERFS_DOCKER` | `Dockerfile`、`apple/boot.mjs` | VM 内的 `apple/run.mjs` 与上游 SDK |
| `LAYERFS_DAEMON_HOST` | `src/docker.ts`、`compose.yaml`、`apple/boot.mjs` | 运行环境内的上游 SDK |
| `LAYERFS_CONTAINER_PREFIX` | `src/docker.ts`、`compose.yaml`、`apple/boot.mjs` | 运行环境内的上游 SDK |

要换 daemon 地址或容器前缀，请改对应的后端配置或 Compose 文件。

### 传输与访问控制

| 变量 | 含义 |
| --- | --- |
| `LAYERFS_MCP_TRANSPORT` | `stdio`（默认）或 `http` |
| `LAYERFS_MCP_HOST`, `LAYERFS_MCP_PORT` | HTTP 默认 `127.0.0.1:8787`，端点 `/mcp` |
| `LAYERFS_MCP_TOKEN` | HTTP Bearer token；绑定非 loopback 地址时必填 |
| `LAYERFS_MCP_BODY_LIMIT` | HTTP JSON 请求上限，默认 `64mb`；stdio 仍受客户端自身限制 |
| `LAYERFS_MCP_READ_ONLY=1` | 只注册具有读取语义的工具 |
| `LAYERFS_MCP_OPERATOR=0` | 隐藏全部 operator 工具 |
| `LAYERFS_MCP_EXEC=0` | 隐藏命令执行与后台进程控制工具 |

### 容器 CLI 定位

| 变量 | 含义 |
| --- | --- |
| `LAYERFS_CONTAINER_BIN` | Apple Container CLI 的绝对路径，供图形客户端使用 |
| `LAYERFS_DOCKER_BIN` | Docker CLI 的绝对路径，供图形客户端使用 |

## CLI 参数

`--backend`、`--source`、`--image`、`--sandbox-image`、`--sandbox-archive`、`--name`、`--cpus`、`--memory`、`--project`、`--sdk-path`、`--store-path`、`--transport`、`--host`、`--port`、`--read-only`、`--no-operator`、`--disable-exec`。同名参数优先于相应环境变量。运行 `layerfs-mcp --help` 查看当前版本的实际选项，生命周期细节见 [统一 CLI](CLI.md)。

## 工具暴露开关

三个开关对两种传输、两种托管后端都生效：

```sh
layerfs-mcp serve --project website --read-only          # 只读
layerfs-mcp serve --project website --no-operator        # 隐藏 operator
layerfs-mcp serve --project website --disable-exec       # 禁用命令执行与后台进程
```

只读模式不提供修改类工作流提示词，`layerfs://capabilities` 会列出当前配置实际启用的方法。想确认收紧后的工具集，让 Agent 先读这个资源。

## 优先级

1. 命令行参数。
2. 环境变量。
3. 已保存的项目配置。
4. 平台默认值。

配置了 `LAYERFS_SDK_PATH` 或 `--sdk-path`、又没显式指定后端时，命令按原生 Linux 模式运行。

## HTTP 安全默认值

- 默认校验 `Origin`；loopback 监听还校验 `Host`，用于阻止 DNS rebinding。
- 非本机部署应放在 TLS 反向代理之后，并显式设置 `LAYERFS_MCP_TOKEN`。
- token 是共享服务凭据，不是多租户鉴权。分支与 Workspace 提供工作隔离，服务本身不提供租户权限边界。
- 不实现 OAuth 授权服务器，也不提供旧版 HTTP+SSE 传输；只支持 OAuth 登录的远程客户端应通过本地 stdio 接入。
