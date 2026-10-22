# Apple Container 后端

**中文** · [English](en/APPLE-CONTAINER.md) · [文档索引](README.md) · [后端总览](BACKENDS.md)

该后端按「一个项目一个 Apple Container VM」运行。Mac 只需要 Node.js 22+、npm 和运行中的 Apple Container 服务；构建、启动和接入均不需要 Docker Engine 或 Docker Desktop。

VM 内包含 Podman/crun，负责创建 LayerFS Sandbox。它使用 Docker 兼容的本地 Unix API，但没有 Docker Engine，也不挂载宿主机的 Docker socket。Agent 仍通过标准 MCP 调用同样的 40 个 LayerFS 方法，另有 `layerfs_status`。

## 为什么在同一 VM 内运行 Sandbox

Apple Container 为每个外层容器提供独立 Linux VM。LayerFS 的直接 Store 模式要求所有访问者共享同一 Linux 内核，并使用本地 ext4/xfs/btrfs，以维持 SQLite WAL 与写入者锁语义。因此不能把每个 Workspace 放进独立 Apple VM，再通过 Mac 共享目录访问同一 Store。

```text
macOS：Agent → layerfs-mcp serve --backend apple-container（MCP stdio / HTTP）
                         │ container exec --interactive
                         ▼
          一个项目的 Apple Container Linux VM
          ├─ MCP 进程 A、B… → 同一个 LayerFS Store
          ├─ Podman/crun → Sandbox A → daemon / FUSE / Workspace
          ├─ Podman/crun → Sandbox B → daemon / FUSE / Workspace
          └─ /state：Apple ext4 命名卷
             ├─ home：LayerFS 私有发现目录
             └─ engine：OCI 镜像、Sandbox 元数据与 Store 卷
```

每个 Agent 的 MCP 进程、Store opener 和 Sandbox daemon 都处于该项目 VM 的同一内核中。项目间使用不同 VM 和卷；同一项目的 Agent 通过分支与 Workspace 协作。Mac 的 VirtioFS 目录只用于只读导入，Store 始终放在 ext4 命名卷上。

依据：[Apple 技术概览](https://github.com/apple/container/blob/main/docs/technical-overview.md)、[Apple 卷文档](https://github.com/apple/container/blob/main/docs/volumes.md)、[固定版本 LayerFS kernel guard](https://github.com/Ephemeral-AI-Lab/layerfs/blob/5fb68ddc1acc3163e3ac3486133bde014c5fbed3/core/crates/layerfs-store-service/src/kernel_guard.rs)。

## 推荐入口：自动准备

```sh
layerfs-mcp serve --backend apple-container --project website --source /absolute/path/website
layerfs-mcp init --project website
layerfs-mcp status --project website
```

本地可先 `npm ci && npm run build && npm link` 安装命令。发布 npm 后，也可用 `npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website` 或 `bunx` 启动。无需手动 `setup` 或构建；首次接入自动准备，`layerfs_status` 返回 `ready` 后可用。统一入口支持 stdio 和 Streamable HTTP，配置与用法见 [CLI 文档](CLI.md)。

以下 `apple ...` 子命令保留给旧部署及手动管理；它与自动准备的统一入口有所区别。

## 手动构建与初始化

在仓库目录执行：

```sh
container system start
npm ci
npm run build
container build --cpus 2 --memory 2G --target apple-runtime -t layerfs-mcp-apple:local .
node dist/cli.js apple setup --project default
node dist/cli.js apple init --project default
node dist/cli.js apple status --project default
```

`setup` 创建 2 CPU、2 GiB 内存的 VM 和 32 GiB 稀疏 ext4 卷。首次准备会下载固定 digest 的 Node 22 Sandbox 镜像，并在 VM 内保存不可变镜像 ID。冷构建需要下载基础镜像、上游代码和 Rust/npm 依赖。

`setup` 和 `serve` 均不会初始化项目；`init` 是显式写入操作。没有指定导入目录时，`init` 仅导入仓库提供的示例 seed。再次初始化已有项目会返回上游 `Exists`。

要导入真实目录，在首次创建新项目时指定只读源：

```sh
node dist/cli.js apple setup --project website --source /absolute/path/website --cpus 4 --memory 4G
node dist/cli.js apple init --project website
```

创建参数只在创建 VM 时生效；已存在 VM 的 `setup` 校验镜像、挂载与资源参数一致后启动并等待就绪，不匹配时明确报错。更换导入目录或 VM 资源时使用新项目，或先自行管理该项目 VM 的配置。默认不挂载用户 home。

## 旧版手动部署的 MCP 配置

将仓库路径替换为实际绝对路径，将配置加入支持 stdio 的 MCP 客户端：

```json
{
  "mcpServers": {
    "layerfs": {
      "command": "node",
      "args": [
        "/absolute/path/LayerFS-MCP/dist/cli.js",
        "apple", "serve", "--project", "default"
      ]
    }
  }
}
```

图形界面启动的客户端若找不到 `node` 或 `container`，使用 Node 的绝对路径，并在客户端环境中设置 `LAYERFS_CONTAINER_BIN=/usr/local/bin/container`。服务日志使用 stderr，stdout 只用于 MCP。每个客户端可启动独立 stdio 进程，它们连接相同的项目 VM；客户端退出后 VM 与项目仍保留。

`apple serve` 会启动已经配置但停止的 VM，不会隐式创建新 VM。可增加 `--read-only`、`--no-operator`、`--disable-exec` 限制工具。旧 `apple serve` 子命令只提供 stdio；统一的 `serve --backend apple-container` 同时支持 stdio 和 Streamable HTTP，并能自动创建运行环境。

可直接使用 [Apple stdio 配置示例](../examples/mcp-apple-stdio.json)。

初始化后运行 `node examples/apple-client.mjs default`，可通过官方 MCP Client 检查工具发现、后端状态与示例文件读取。

## 生命周期和自定义镜像

```sh
node dist/cli.js apple serve --project default
node dist/cli.js apple stop --project default
# 下次 serve 自动启动同一 VM，继续使用相同的卷。
node dist/cli.js apple --help
```

VM 名由项目名和哈希确定，也可通过 `--name` 指定；后续命令需使用相同名称。CLI 校验归属标签、项目、上游版本与卷，拒绝接管无关容器。状态卷名为 `<VM 名>-state`。

停止 VM 会终止运行中的 Sandbox/后台进程，应先检查并提交 Workspace。数据卷保留不改变上游 Disposable Store 的性质：没有崩溃或断电持久性保证，重要数据应保留独立原始副本。本后端不会自动迁移、删除或接管其他部署的 Store。

自定义 Sandbox 镜像必须满足上游运行环境约定，例如 Linux glibc、可运行 daemon、所需编译/运行工具。设置 `--sandbox-image registry.example/image@sha256:...`；镜像在 VM 内下载，并固定到实际 image ID。离线环境可同时指定 `--sandbox-archive /absolute/path/image.oci.tar` 与 archive 内的 `--sandbox-image` 引用；archive 只读挂载，保留至 VM 不再需要它。使用 `--image` 可选择预先通过 Apple Container 构建或加载的 LayerFS-MCP runtime 镜像。

## 权限和兼容范围

外层 VM 需要 `--cap-add ALL --masked-path NONE --read-only-path NONE`，以便 VM 内使用 namespace、cgroup、OCI 挂载和 FUSE。其权限位于项目 VM 内；仅连接可信 Agent。Sandbox 内继续使用上游非 root 执行身份、空有效 capability、禁止新用户 namespace 的 seccomp 策略。

[兼容补丁](../patches/apple-container-podman.patch) 只在显式 `LAYERFS_ENGINE=podman` 时处理 seccomp 文件路径、inspect 元数据规范化和日志媒体类型别名。Podman 4.3 的 Docker 兼容 inspect 不返回 FUSE 设备权限字符串；此模式仅对单个准确的 `/dev/fuse` 映射接受该空字段，并继续执行设备路径、挂载、身份与真实 FUSE 就绪检查。日志仍由原有严格多路复用帧解析器验证。默认 Docker 路径保留原有检查。

已实测：Apple Silicon、macOS 27.0.1、Apple Container 1.6.0、Linux 6.18.35、VM 内 Podman 4.3.1 / crun 1.8.1。其他版本应运行以下独立测试后使用：

```sh
npm test
npm run test:apple
```

`test:apple` 创建临时项目 VM，使用官方 MCP Client 经 Mac CLI 调用全部 40 个方法、FUSE、命令和后台进程，再验证第二个独立客户端可读取同一项目；结束后仅清理它创建且通过归属检查的 VM 和卷。不会使用正式项目 Store。
