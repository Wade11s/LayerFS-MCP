# LayerFS-MCP

让支持 MCP 的 Agent 通过标准工具使用 [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs)：共享历史、隔离工作区、自动检查点、分支、合并、发布、去重存储与后台进程。

服务使用官方 MCP TypeScript SDK，提供 **stdio** 和 **Streamable HTTP**。默认提供 **41 个工具**：27 个 LayerFS 公开方法、13 个 operator 方法、1 个服务状态工具；另有 3 个资源和 1 个工作流提示词。支持这两种传输之一的 MCP 客户端均可接入，客户端的注册配置以各自要求为准。

## 上游版本与完整性

固定上游提交：[`5fb68ddc1acc3163e3ac3486133bde014c5fbed3`](https://github.com/Ephemeral-AI-Lab/layerfs/tree/5fb68ddc1acc3163e3ac3486133bde014c5fbed3)，详见 [upstream.lock.json](upstream.lock.json)。该提交已使用 `workspace.*` 管理工作区，公开方法实际为 27 个；上游 README 中保留的「29 方法」描述来自旧的 `sandbox.*` 契约。

所有功能调用真实上游 SDK。存储格式、去重、检查点、`.lww` 冲突规则和合并算法均由 LayerFS 实现。本项目不包含模拟存储后端。`npm run verify:upstream` 会比较实际导出的方法集合，升级上游时新增或缺失的方法都会使检查失败。

原生构建额外应用仓库内记录的 [Podman 兼容补丁](patches/apple-container-podman.patch)，仅在 Apple 后端显式启用；补丁校验和记录在 lock 文件中。

| 能力 | MCP 工具组 |
| --- | --- |
| 从目录初始化项目、枚举分支 | `layerfs_project_*` |
| 按行读取、目录列表、元数据、grep、glob、文件差异、blame | `layerfs_fs_*` |
| 文本/二进制写入、精确编辑、原子批量修改、目录、删除、复制、移动 | `layerfs_fs_*` |
| 从任意历史状态 fork、提交历史、差异、合并、发布 | `layerfs_branch_*` |
| FUSE 工作区挂载、命令执行、状态、提交、卸载 | `layerfs_workspace_*` |
| 存储/文件/覆盖层诊断、历史快照、初始化进度 | `layerfs_operator_*` |
| 后台进程启动、列出和取消 | `layerfs_operator_process_*` |

完整参数与语义见 [API 文档](docs/API.md)。

## 快速启动：统一 CLI

本地开发版安装：

```sh
npm ci
npm run build
npm link
layerfs-mcp serve --backend apple-container --project website
# Docker 用户：
layerfs-mcp serve --backend docker --project another-project
```

不必手动运行 `setup`。`serve` 自动准备镜像、项目卷与运行环境，并立即提供 MCP 握手；首次构建期间通过 `layerfs_status` 查看 `preparing`，变为 `ready` 后即可调用 LayerFS。项目配置保存在用户配置目录，后续只需 `layerfs-mcp serve --project website`。

Mac 的 Apple 后端按一个项目一个 Linux VM 运行，VM 内 Podman/crun 承载全部 Workspace，共享原有 Store，不需要 Docker。Docker 后端使用可用的 Linux Docker Engine / Docker Desktop。两种后端都需要 Node.js 22+ 和对应容器引擎。

npm 安装与启动：

```sh
npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website
bunx layerfs-mcp@0.1.0 serve --backend apple-container --project website
```

包内包含构建 runtime 所需源码与锁文件，不依赖本地仓库 checkout。`npx` / `bunx` 不替代容器引擎安装。完整命令、后端选择、可选预热、HTTP 和生命周期见 [统一 CLI 文档](docs/CLI.md)。

`serve` 不自动导入文件。首次创建项目时可加 `--source /absolute/path/project`，然后显式执行 `layerfs-mcp init --project website`，或让 Agent 调用 `layerfs_project_init({sourcePath:"/source"})`。没有 source 时，CLI 的 `init` 导入示例 seed。

Agent 优先使用 [统一 stdio 配置](examples/mcp-unified-stdio.json)；发布后可用 [npx 配置](examples/mcp-npx.json)。Apple 架构、旧部署接入和自定义镜像见 [Apple Container 文档](docs/APPLE-CONTAINER.md)。

## 手动部署：Docker Compose

要求：Node.js 22+、npm、运行中的 Docker Engine / Docker Desktop。完整工作区需要 Docker Linux 内核提供 `/dev/fuse`。镜像会编译固定版本的 Linux addon 和 daemon，并包含 Node、Python、Git、gcc、make，可作为默认 Sandbox 运行镜像。

```sh
npm ci
npm test
docker build -t layerfs-mcp:local .
npm run docker:configure
```

`docker:configure` 创建权限为 0600 的 `.env`，写入随机 Bearer token 和本地镜像的不可变 ID，拒绝覆盖已有文件。也可以手动复制 `.env.example` 并填写配置。冷构建需要下载基础镜像和 Rust 依赖。

**macOS / Docker Desktop：**

```sh
docker compose up -d --no-build
```

**Linux：** 使用 host 网络接入 LayerFS 发布在 Docker 主机 loopback 上的 daemon 端口。

```sh
docker compose -f compose.yaml -f compose.linux.yaml up -d --no-build
```

HTTP MCP 地址为 `http://127.0.0.1:8787/mcp`，请求头为 `Authorization: Bearer <.env 中的 LAYERFS_MCP_TOKEN>`。默认只将端口发布到本机。

首次使用时，显式导入示例项目，再检查连接：

```sh
node examples/client.mjs --init /source
node examples/client.mjs
```

`/source` 是服务容器中的目录，由 Compose 将 `LAYERFS_SOURCE_DIR` 只读挂载进去。改为导入真实项目时，应在首次初始化之前修改 `.env` 中的该路径并重新启动服务。启动服务不会自动初始化或覆盖项目。已有项目再次初始化会返回上游 `Exists`。

一个服务实例选择一个项目；若要运行其他项目，使用不同的项目名、home、Store 卷、容器前缀和端口。不能只修改项目名而复用同一个 Store 文件。多个 Agent 可共享同一个项目，分别使用自己的分支与 Workspace。

## 让 Agent 接入

### stdio：手动 Docker Compose 部署

将 [examples/mcp-stdio.json](examples/mcp-stdio.json) 中的项目路径替换成此仓库的绝对路径，加入客户端 MCP 配置：

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

Linux 在 `run` 之前增加 `-f /absolute/path/LayerFS-MCP/compose.yaml -f /absolute/path/LayerFS-MCP/compose.linux.yaml`。每个客户端可以启动自己的 MCP 进程；它们通过相同的命名卷共享项目历史。无需同时运行 HTTP 服务。

项目初始化后，可运行 `node examples/stdio-client.mjs` 验证这条配置链路。

### Streamable HTTP

[examples/mcp-http.json](examples/mcp-http.json) 提供常见客户端配置形态。支持 URL 和请求头的客户端可使用 `/mcp` 和 Bearer token；也可参考官方 SDK 客户端示例 [examples/client.mjs](examples/client.mjs)。仅支持 OAuth 登录、不能设置自定义 Bearer 请求头的远程客户端，应通过其本地 stdio 模式接入。本服务当前不实现 OAuth 授权服务器或旧版 HTTP+SSE 传输。

### Linux 原生模式

LayerFS SDK 尚未公开发布到 npm，需要先检出并编译上游：

```sh
git clone https://github.com/Ephemeral-AI-Lab/layerfs.git /absolute/path/layerfs
git -C /absolute/path/layerfs checkout 5fb68ddc1acc3163e3ac3486133bde014c5fbed3
cd /absolute/path/layerfs
cargo +1.85.1 fetch --manifest-path core/Cargo.toml --locked
npm --prefix sdk/js run build:native
cargo +1.85.1 build --manifest-path core/Cargo.toml --locked --release -p layerfs-daemon
```

按上游 [SDK 指南](https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/sdk/js/README.md) 配置 Store 和部署环境，再运行：

```sh
cd /absolute/path/LayerFS-MCP
npm ci
npm run build
export LAYERFS_SDK_PATH=/absolute/path/layerfs
export LAYERFS_MCP_PROJECT=website
export LAYERFS_HOME=/absolute/private/layerfs-home
export LAYERFS_STORE_PATH=/absolute/local/store-volume/global/store.sqlite
# 完整 Workspace 还需 LAYERFS_IMAGE、LAYERFS_VOLUME、LAYERFS_DAEMON，见下表。
node dist/cli.js doctor
node dist/cli.js --transport stdio
```

原生 Store 仅支持与 daemon 共享同一 Linux 内核的 ext4/xfs/btrfs。上述 Docker 配置中，Store 路径必须位于 Sandbox 使用的同一 Docker 命名卷中；可从 `docker volume inspect` 获取 Linux 主机上的卷位置。不要将 Store 放在 macOS bind mount、NFS 或 SMB 上。macOS 上可使用上文的 Apple Container 后端；Windows 客户端可连接 Linux 容器或 Linux 远程服务。

## 配置

| 环境变量 | 含义 |
| --- | --- |
| `LAYERFS_SDK_PATH` | 固定版本的 LayerFS checkout 或其 `sdk/js` 目录；Docker 镜像已设置 |
| `LAYERFS_MCP_BACKEND` | `apple`、`docker` 或 `native`；优先使用 CLI 显式选择 |
| `LAYERFS_MCP_CONFIG_DIR` | 托管项目配置目录，默认 `~/.config/layerfs-mcp` |
| `LAYERFS_MCP_PROJECT` | 当前项目名，默认 `default` |
| `LAYERFS_STORE_PATH` | Linux 本地 Store 路径；容器中为 `/layerfs-store/global/store.sqlite` |
| `LAYERFS_HOME` | 上游私有发现目录，属当前用户且权限 0700 |
| `LAYERFS_NATIVE` | 可选 native addon 路径，默认由上游 SDK 选择 |
| `LAYERFS_IMAGE` | 已存在于本地 Docker Engine 的不可变 `sha256:...` 镜像 ID |
| `LAYERFS_VOLUME` | Sandbox 与 MCP 共同使用的现有本地命名卷 |
| `LAYERFS_DAEMON` | MCP 进程可读取的 Linux daemon 文件；SDK 会将其传入 Sandbox |
| `LAYERFS_DOCKER` | 本地 Docker socket，默认 `/var/run/docker.sock` |
| `LAYERFS_ENGINE` | 默认 `docker`；Apple runtime 自动设置 `podman` 并配置 VM 内兼容 socket |
| `LAYERFS_DAEMON_HOST` | daemon 端口的访问地址；Linux host 网络用 `127.0.0.1`，Docker Desktop 容器用 `host.docker.internal` |
| `LAYERFS_CONTAINER_PREFIX` | 同一 Engine 上区分部署的容器名前缀 |
| `LAYERFS_MCP_STORE_POLICY` | 可选 JSON：`smallFileThreshold`、`wholeFileDepth`、`chunkDepth`、`metadataDepth`，仅在 Init 时写入 Store |
| `LAYERFS_TRACE`, `LAYERFS_TRACE_STEP`, `LAYERFS_TRACE_START` | 上游调用追踪配置，原样传递 |
| `LAYERFS_MCP_TRANSPORT` | `stdio`（默认）或 `http` |
| `LAYERFS_MCP_HOST`, `LAYERFS_MCP_PORT` | HTTP 默认 `127.0.0.1:8787` |
| `LAYERFS_MCP_TOKEN` | HTTP Bearer token；绑定非 loopback 地址时必填 |
| `LAYERFS_MCP_BODY_LIMIT` | HTTP JSON 请求上限，默认 `64mb`；stdio 仍受客户端自身限制 |
| `LAYERFS_MCP_READ_ONLY=1` | 只注册具有读取语义的工具 |
| `LAYERFS_MCP_OPERATOR=0` | 隐藏全部 operator 工具 |
| `LAYERFS_MCP_EXEC=0` | 隐藏命令执行与后台进程控制工具 |

CLI 支持 `--backend`、`--source`、`--image`、`--project`、`--sdk-path`、`--store-path`、`--transport`、`--host`、`--port`、`--read-only`、`--no-operator`、`--disable-exec`，优先于相应环境变量。运行 `layerfs-mcp --help` 查看；完整生命周期命令见 [CLI 文档](docs/CLI.md)。

HTTP 默认校验 Origin；loopback 监听还校验 Host，以防 DNS rebinding。非本机部署应放在 TLS 反向代理后。token 是共享服务凭据；分支与 Workspace 提供工作隔离，服务本身不提供租户权限边界。默认完整模式具有目录导入、命令执行和 Docker 权限，应仅连接可信 Agent。

## 工作方式与限制

1. `layerfs_status` 检查配置，托管模式等待 `runtimeState=ready`，再用 `layerfs_project_init` 显式导入目录。
2. `layerfs_branch_fork` 为每个 Agent 建立分支。`main` 只通过 publish 更新。
3. `fs` 修改自动生成检查点；`fs.apply` 在一个检查点中原子应用有序修改。
4. 命令使用 `workspace_mount → workspace_exec → workspace_commit → workspace_unmount`。保存 mount 返回的 `{sandbox,path}`，每个 Workspace 上的操作按顺序进行。
5. 命令失败也可能修改文件。检查并提交后再卸载；脏工作区默认拒绝卸载，显式 `discard=true` 才丢弃未提交内容。服务退出不会擅自卸载工作区或取消后台进程。
6. 使用 merge 合并分支，再按任务要求 publish。回到旧状态使用旧 commit/layer 作为 `fork.fromRef`；上游没有原地 reset、项目删除或 GC 公共 API。

返回结果同时提供 JSON 文本和 `structuredContent.result`。错误为 `isError=true`，保留 `code/message/detail`；分页、冲突省略标记、`null` 指标和完整命令输出均不会被桥接层静默裁剪。二进制写入使用 `encoding: "base64"`，读取二进制文件可通过 Workspace 命令处理，因为上游 `fs.read` 只读文本。

服务不自动重试。`Unknown`、客户端超时或断线不表示操作没有发生，也不保证原生命令已经停止；应先检查进程、工作区和提交历史。若需要取消后台任务，使用 operator process 方法。上游 **Disposable Store 没有崩溃/断电持久性保证**，应保留可重建数据的原始副本；MCP 层不改变此性质。

## 验证与开发

GitHub 推送与 npm 自动发布见 [发布指南](docs/RELEASING.md)：`main` 上的新稳定版本经过检查后使用 OIDC 发布，已发布版本跳过；首次需完成 npm 包创建和 Trusted Publisher 配置。

```sh
npm run check
npm test
LAYERFS_SDK_PATH=/absolute/path/layerfs npm run verify:upstream
# 构建镜像后，使用独立临时卷真实调用全部 40 个上游方法：
npm run test:docker
# macOS，先构建 apple-runtime 镜像：
npm run test:apple
# 统一 CLI：不运行 setup，验证并发接入、全部方法和重启：
npm run test:managed
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

`npm test` 使用官方 MCP Client 验证协议、工具 schema、参数转换、分页和错误保留、策略限制、stdio 与 HTTP。`test:docker` 使用真实 native addon、Store 和 FUSE，并在结束后清理它创建的容器与卷。它不会使用部署的正式 Store。`test:real` 是供显式配置原生环境使用的底层入口，需设置 `LAYERFS_REAL_TESTS=1` 才会写入数据。

构建镜像时已有固定版本的上游 checkout，可避免重复下载：

```sh
docker build --build-context layerfs=/absolute/path/layerfs -t layerfs-mcp:local .
```

传入的 checkout 必须是锁定提交；升级后先运行契约检查和真实测试。项目许可证为 MIT，上游和依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
