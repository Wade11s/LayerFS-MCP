# LayerFS-MCP

[English](README.en.md) · **中文**

让支持 MCP 的 Agent 通过标准工具使用 [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs)：共享历史、隔离工作区、自动检查点、分支、合并、发布与去重存储。

一个服务实例绑定一个项目，默认暴露 **41 个工具**（27 个 LayerFS 公开方法、13 个 operator 方法、1 个状态工具）、3 个资源与 1 个工作流提示词，同时支持 **stdio** 与 **Streamable HTTP**。

## 快速开始

要求：Node.js 22+，以及一个容器引擎——macOS 用 [Apple Container](https://github.com/apple/container)，其他平台用 Docker Engine / Docker Desktop。

```sh
# 首次：指定导入源启动，运行环境自动准备，不需要手动 setup
npx -y layerfs-mcp@0.1.0 serve --backend apple-container --project website --source /absolute/path/website

# 另开一个终端：显式导入项目（serve 不会自动导入文件）
npx -y layerfs-mcp@0.1.0 init --project website

# 之后配置已保存，直接启动
npx -y layerfs-mcp@0.1.0 serve --project website
```

Docker 用户把 `--backend apple-container` 换成 `--backend docker`。

`serve` 会立即完成 MCP 握手并列出工具。首次构建镜像期间 `layerfs_status` 返回 `preparing`，变为 `ready` 后即可调用 LayerFS 方法。完整的安装方式、导入和验证步骤见 [快速上手](docs/QUICKSTART.md)。

### 接入 Agent

把下面这段加进客户端的 MCP 配置（也可直接用 [examples/mcp-unified-stdio.json](examples/mcp-unified-stdio.json)）：

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

未全局安装时把 `command` 换成 `npx`，args 从 `-y`, `layerfs-mcp@0.1.0` 开始（见 [examples/mcp-npx.json](examples/mcp-npx.json)）。需要远程或共享接入时用 Streamable HTTP：

```sh
layerfs-mcp serve --project website --transport http --host 127.0.0.1 --port 8787
# 端点 http://127.0.0.1:8787/mcp，请求头 Authorization: Bearer <LAYERFS_MCP_TOKEN>
```

## 能做什么

| 能力 | 工具组 |
| --- | --- |
| 从目录初始化项目、枚举分支 | `layerfs_project_*` |
| 按行读取、目录列表、元数据、grep、glob、文件差异、blame | `layerfs_fs_*` |
| 文本/二进制写入、精确编辑、原子批量修改、目录、删除、复制、移动 | `layerfs_fs_*` |
| 从任意历史状态 fork、提交历史、差异、合并、发布 | `layerfs_branch_*` |
| FUSE 工作区挂载、命令执行、状态、提交、卸载 | `layerfs_workspace_*` |
| 存储/文件/覆盖层诊断、历史快照、初始化进度 | `layerfs_operator_*` |
| 后台进程启动、列出和取消 | `layerfs_operator_process_*` |

存储格式、去重、检查点、`.lww` 冲突规则和合并算法都由上游 LayerFS 实现，本项目不包含模拟存储后端。完整参数与语义见 [MCP API](docs/API.md)。

## 文档

| 我想… | 看 |
| --- | --- |
| 5 分钟跑通并接入 Agent | [快速上手](docs/QUICKSTART.md) |
| 查全部工具、参数和返回结构 | [MCP API](docs/API.md) |
| 用 CLI 管理镜像、项目、HTTP 和生命周期 | [统一 CLI](docs/CLI.md) |
| 配置环境变量、项目配置和访问控制 | [配置](docs/CONFIGURATION.md) |
| 在 Apple、Docker、原生 Linux 之间选后端 | [后端](docs/BACKENDS.md) |
| 了解检查点、分支、合并和并发约定 | [工作方式](docs/HOW-IT-WORKS.md) |
| 跑测试、看已验证的范围 | [测试与验证](docs/TESTING.md) |
| 排查启动失败、导入冲突、连不上 | [故障排查](docs/TROUBLESHOOTING.md) |
| 发布到 npm | [发布指南](docs/RELEASING.md) |

中文文档在 `docs/`，英文文档在 `docs/en/`，两边页面一一对应。

## 边界

- 默认完整模式具备目录导入、命令执行和 Docker 权限，只连接可信 Agent。分支与 Workspace 提供工作隔离，不构成租户权限边界。
- 服务不自动重试。超时或断线不表示操作没有发生，应先检查进程、工作区和提交历史。
- 上游 **Disposable Store 没有崩溃/断电持久性保证**，重要数据请保留可重建的原始副本。MCP 层不改变这一性质。
- 一个实例一个项目。要跑另一个项目，请使用不同的项目名、home、Store 卷、容器前缀和端口。

## 开发

```sh
npm ci
npm run build
npm run check      # tsc --noEmit
npm test           # 协议、schema、参数转换、分页、错误保留、stdio 与 HTTP
```

需要真实 Store / FUSE / 容器引擎的测试见 [测试与验证](docs/TESTING.md)。

许可证 MIT；上游与依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
